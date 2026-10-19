import crypto from "crypto";
import express, { NextFunction, Request, Response } from "express";
import type { Config } from "./config";
import type { Forwarder, ForwardEvent } from "./forward";
import type { PayMongo } from "./paymongo";
import { verifyPaymongoSignature } from "./signature";

/**
 * Routes (SPEC-PAYMENT-GATEWAY.md §3.3). Everything except /health and
 * /webhook needs `Authorization: Bearer <GATEWAY_TOKEN>`.
 * The gateway is stateless: it stores nothing and decides nothing about a
 * rental; the main API's database stays the source of truth.
 */

export const VERSION = "0.1.0";
const MAX_AMOUNT = 100_000; // pesos; far above any rental, catches a unit mistake (centavos sent as pesos)

class BadRequest extends Error {}

function str(v: unknown, field: string, max = 500): string {
  if (typeof v !== "string" || !v.trim()) throw new BadRequest(`${field} is required`);
  if (v.length > max) throw new BadRequest(`${field} is too long`);
  return v.trim();
}

function amount(v: unknown, field = "amount"): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new BadRequest(`${field} must be a number of pesos`);
  if (v <= 0) throw new BadRequest(`${field} must be more than zero`);
  if (v > MAX_AMOUNT) throw new BadRequest(`${field} is above the ${MAX_AMOUNT} peso limit`);
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) throw new BadRequest(`${field} has more than 2 decimals`);
  return v;
}

function httpsUrl(v: unknown, field: string): string {
  const s = str(v, field, 2000);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new BadRequest(`${field} must be a URL`);
  }
  if (u.protocol !== "https:") throw new BadRequest(`${field} must be https`);
  return s;
}

function stringMap(v: unknown, field: string): Record<string, string> {
  if (v === undefined) return {};
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequest(`${field} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== "string") throw new BadRequest(`${field}.${k} must be a string`);
    out[k] = val;
  }
  return out;
}

const ID_RE = /^[A-Za-z0-9_]{3,100}$/;
function pmId(v: unknown, field: string): string {
  const s = str(v, field, 100);
  if (!ID_RE.test(s)) throw new BadRequest(`${field} is not a valid PayMongo id`);
  return s;
}

function provider(v: unknown): "instapay" | "pesonet" {
  if (v === "instapay" || v === "pesonet") return v;
  throw new BadRequest('provider must be "instapay" or "pesonet"');
}

function tokenMatches(expected: string, header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

/** What the forwarded event says, from a PayMongo webhook payload. */
export function eventFromPayload(mode: Config["env"], payload: any): ForwardEvent | null {
  const attrs = payload?.data?.attributes;
  const type = typeof attrs?.type === "string" ? attrs.type : "";
  const resource = attrs?.data;
  if (!type || !resource) return null;
  const ev: ForwardEvent = {
    mode,
    eventId: typeof payload?.data?.id === "string" ? payload.data.id : "",
    type,
    livemode: Boolean(attrs.livemode),
  };
  if (resource.type === "checkout_session" || String(resource.id ?? "").startsWith("cs_")) {
    ev.checkoutId = resource.id;
    const pays: Array<{ id?: string }> = resource.attributes?.payments ?? [];
    if (pays[0]?.id) ev.paymentId = pays[0].id;
  } else if (resource.type === "payment" || String(resource.id ?? "").startsWith("pay_")) {
    ev.paymentId = resource.id;
  }
  return ev;
}

export function createApp(cfg: Config, pm: PayMongo, fwd: Forwarder, log: (msg: string) => void = console.log) {
  const app = express();
  app.disable("x-powered-by");
  const started = Date.now();

  // ── public ────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mode: cfg.env,
      keyMode: cfg.paymongoSecretKey.startsWith("sk_live_") ? "live" : "test",
      webhookConfigured: Boolean(cfg.webhookSecret),
      transfersConfigured: Boolean(cfg.sourceAccount),
      version: VERSION,
      uptimeS: Math.round((Date.now() - started) / 1000),
    });
  });

  // The raw bytes are needed for the signature: no JSON parser before this.
  app.post("/webhook", express.raw({ type: "*/*", limit: "1mb" }), (req: Request, res: Response) => {
    if (!cfg.webhookSecret) {
      res.status(503).json({ error: "webhook secret not configured on this gateway" });
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    if (!verifyPaymongoSignature(raw, req.header("Paymongo-Signature"), cfg.webhookSecret, cfg.env)) {
      log(`[webhook] rejected: bad or wrong-mode signature`);
      res.status(400).json({ error: "invalid signature" });
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.status(400).json({ error: "body is not JSON" });
      return;
    }
    // Answer PayMongo at once (it gives up after 30 s and disables webhooks
    // after repeated failures); forwarding happens after the reply.
    res.status(200).json({ received: true });
    const ev = eventFromPayload(cfg.env, payload);
    if (!ev) {
      log(`[webhook] signed event without a resource: not forwarded`);
      return;
    }
    if (ev.livemode !== (cfg.env === "live")) {
      log(`[webhook] ${ev.type} ${ev.eventId}: livemode=${ev.livemode} does not match the ${cfg.env} gateway: not forwarded`);
      return;
    }
    void fwd.forward(ev).then((r) => log(`[webhook] ${ev.type} ${ev.eventId} -> main API: ${r.ok ? "ok" : `NOT delivered (${r.reason ?? r.status}); the poller will catch it`}`));
  });

  // ── token-protected ───────────────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!tokenMatches(cfg.gatewayToken, req.header("Authorization"))) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "100kb" }));

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  app.get("/status", wrap(async (_req, res) => {
    let walletReady: boolean | null = null;
    try {
      walletReady = await pm.walletReady();
    } catch {
      walletReady = null;
    }
    res.json({ mode: cfg.env, walletReady, mainApi: await fwd.currentMainApi() });
  }));

  app.post("/checkouts", wrap(async (req, res) => {
    const b = req.body ?? {};
    const out = await pm.createCheckout({
      amount: amount(b.amount),
      name: str(b.name, "name", 200),
      description: str(b.description, "description", 500),
      successUrl: httpsUrl(b.successUrl, "successUrl"),
      cancelUrl: httpsUrl(b.cancelUrl, "cancelUrl"),
      metadata: stringMap(b.metadata, "metadata"),
    });
    res.status(201).json(out);
  }));

  app.get("/checkouts/:id", wrap(async (req, res) => {
    const info = await pm.getCheckout(pmId(req.params.id, "checkout id"));
    if (info.livemode !== (cfg.env === "live")) {
      res.status(409).json({ error: `checkout livemode=${info.livemode} does not match the ${cfg.env} gateway` });
      return;
    }
    res.json(info);
  }));

  app.post("/checkouts/:id/expire", wrap(async (req, res) => {
    await pm.expireCheckout(pmId(req.params.id, "checkout id"));
    res.json({ expired: true });
  }));

  app.post("/refunds", wrap(async (req, res) => {
    const b = req.body ?? {};
    const out = await pm.refund({
      paymentId: pmId(b.paymentId, "paymentId"),
      amount: amount(b.amount),
      reason: str(b.reason ?? "others", "reason", 50),
    });
    res.status(201).json(out);
  }));

  app.get("/transfers/institutions", wrap(async (req, res) => {
    res.json({ data: await pm.institutions(provider(req.query.provider)) });
  }));

  app.post("/transfers", wrap(async (req, res) => {
    if (!cfg.sourceAccount) {
      res.status(409).json({ error: "transfers are not configured: set PAYMONGO_SOURCE_ACCOUNT_NUMBER and _NAME (the platform's PayMongo wallet)" });
      return;
    }
    const b = req.body ?? {};
    const d = b.destination ?? {};
    const out = await pm.transfer({
      source: cfg.sourceAccount,
      provider: provider(b.provider),
      amount: amount(b.amount),
      destination: { number: str(d.number, "destination.number", 40), name: str(d.name, "destination.name", 120), bic: str(d.bic, "destination.bic", 20) },
      referenceNumber: str(b.referenceNumber, "referenceNumber", 60).replace(/[^A-Za-z0-9]/g, ""),
      purpose: str(b.purpose ?? "EngiRent payout", "purpose", 120),
    });
    res.status(201).json(out);
  }));

  // ── errors ────────────────────────────────────────────────────────────────
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BadRequest) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "body is not valid JSON" });
      return;
    }
    // A PayMongo error: pass its status and its own error list through, never the key or headers.
    const e = err as { response?: { status?: number; data?: { errors?: unknown } }; message?: string };
    if (e?.response?.status) {
      log(`[paymongo] ${e.response.status} ${JSON.stringify(e.response.data?.errors ?? "").slice(0, 300)}`);
      res.status(502).json({ error: "PayMongo refused the request", paymongoStatus: e.response.status, paymongoErrors: e.response.data?.errors ?? null });
      return;
    }
    log(`[gateway] error: ${e?.message ?? String(err)}`);
    res.status(502).json({ error: "could not reach PayMongo" });
  });

  return app;
}
