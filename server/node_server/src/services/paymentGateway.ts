import crypto from "crypto";
import axios from "axios";
import env from "../config/env";
import logger from "../utils/logger";

/**
 * The PayMongo payment gateway (server/payment_gateway, on Render), from the
 * main API's side. SPEC-PAYMENT-GATEWAY.md §3. Every PayMongo action this
 * server takes goes through here; the PayMongo secret key lives only on Render.
 *
 * One gateway per mode. `PAYMENT_GATEWAY` picks the one NEW payments use; an
 * existing transaction always talks to the gateway of its own `paymentEnv`
 * (a sandbox checkout made before a switch to live keeps resolving against the
 * sandbox, so a test payment can never be confirmed as real money).
 *
 * `PAYMENT_MODE=MANUAL` stays the kill switch: no new payment is created on any
 * gateway (that is what "refuse PAYMENT_GATEWAY=live while MANUAL" means, §6).
 * The API still starts, because the emergency stop in §8.7 is exactly
 * "set MANUAL and restart" with PAYMENT_GATEWAY=live still in the file.
 * Existing gateway payments are still polled and refunded through their own
 * gateway: stopping new money must not strand money already taken.
 */

export type PaymentEnv = "sandbox" | "live";

/** The SPEC §5 copy, shown verbatim by the app (it displays the server's message). */
export const WAKING_MESSAGE =
  "Connecting to the payment service… This can take up to a minute when it hasn't been used for a while. Please keep this screen open.";

/** The gateway did not answer quickly: it is probably waking up. Nothing was charged. */
export class GatewayWaking extends Error {
  constructor() {
    super(WAKING_MESSAGE);
  }
}

/** The gateway answered but is the wrong one, or is not configured: fail closed. */
export class GatewayUnavailable extends Error {}

interface Target {
  url: string;
  token: string;
}

function target(e: PaymentEnv): Target | null {
  const url = (e === "live" ? env.PAYMENT_GATEWAY_LIVE_URL : env.PAYMENT_GATEWAY_SANDBOX_URL) ?? "";
  const token = (e === "live" ? env.PAYMENT_GATEWAY_LIVE_TOKEN : env.PAYMENT_GATEWAY_SANDBOX_TOKEN) ?? "";
  if (!url.trim() || token.trim().length < 32) return null;
  return { url: url.trim().replace(/\/+$/, ""), token: token.trim() };
}

export function gatewayConfigured(e: PaymentEnv): boolean {
  return target(e) !== null;
}

/** The mode new payments are created in, or null when they go to the manual fallback. */
export function activeEnv(): PaymentEnv | null {
  if (env.PAYMENT_MODE === "MANUAL") return null;
  const g = env.PAYMENT_GATEWAY;
  if (g !== "sandbox" && g !== "live") return null;
  return gatewayConfigured(g) ? g : null;
}

/**
 * The gateway of an existing transaction. Rows from before P2 have no
 * `paymentEnv`; every PayMongo row then was made with the TEST key (the live
 * key was never installed on the server: PROGRESS 2026-10-19 21:30), so they
 * belong to the sandbox. If that were ever wrong it fails closed: the sandbox
 * gateway 409s a live checkout, and PayMongo 404s a refund of a live payment.
 */
export function envOf(tx: { paymentEnv?: string | null; paymongoCheckoutId?: string | null; paymongoPaymentId?: string | null }): PaymentEnv | null {
  if (tx.paymentEnv === "sandbox" || tx.paymentEnv === "live") return tx.paymentEnv;
  if (tx.paymentEnv) return null; // an unknown value is never guessed
  return tx.paymongoCheckoutId || tx.paymongoPaymentId ? "sandbox" : null;
}

function need(e: PaymentEnv): Target {
  const t = target(e);
  if (!t) throw new GatewayUnavailable(`The ${e} payment gateway is not configured (PAYMENT_GATEWAY_${e.toUpperCase()}_URL / _TOKEN)`);
  return t;
}

async function call<T>(e: PaymentEnv, method: "get" | "post", path: string, data?: unknown, timeout = 20_000): Promise<T> {
  const t = need(e);
  const res = await axios.request({
    method,
    url: `${t.url}${path}`,
    data,
    timeout,
    headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
  });
  return res.data as T;
}

export interface GatewayHealth {
  mode: string;
  keyMode: string;
  webhookConfigured?: boolean;
  version?: string;
  uptimeS?: number;
}

/** GET /health. Throws GatewayWaking when it does not answer within `timeoutMs`. */
export async function health(e: PaymentEnv, timeoutMs = 8_000): Promise<GatewayHealth> {
  const t = need(e);
  try {
    const res = await axios.get(`${t.url}/health`, { timeout: timeoutMs });
    return res.data as GatewayHealth;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // Render answers a waking service slowly, or with a 502/503 while it boots.
    if (status === undefined || status >= 500) throw new GatewayWaking();
    throw new GatewayUnavailable(`The ${e} payment gateway's health check answered ${status}`);
  }
}

/**
 * Before any new payment: the gateway must say it is the mode we expect, with
 * the matching kind of key. Pointing the sandbox URL at the live gateway (or
 * the reverse) fails closed here, never mixes money.
 */
export async function assertGatewayMode(e: PaymentEnv, timeoutMs?: number): Promise<GatewayHealth> {
  const h = await health(e, timeoutMs);
  const wantKey = e === "live" ? "live" : "test";
  if (h?.mode !== e || h?.keyMode !== wantKey) {
    throw new GatewayUnavailable(
      `Payment gateway mode mismatch: PAYMENT_GATEWAY=${e} but the gateway at that URL reports mode=${h?.mode ?? "?"}, keyMode=${h?.keyMode ?? "?"}. No payment was created. Fix PAYMENT_GATEWAY_${e.toUpperCase()}_URL.`,
    );
  }
  return h;
}

/**
 * Fire-and-forget wake-up: a free Render service sleeps after 15 min and takes
 * about a minute to wake. Called when a payment is coming (SPEC §4) so the
 * gateway is awake by the time the student taps Pay. Never throws, never waits.
 */
export function wake(e: PaymentEnv | null = activeEnv()): void {
  if (!e) return;
  const t = target(e);
  if (!t) return;
  try {
    void Promise.resolve(axios.get(`${t.url}/health`, { timeout: 90_000 })).catch(() => undefined);
  } catch {
    /* never let a wake-up break the request that triggered it */
  }
}

// ── PayMongo actions (pesos in, pesos out; the gateway converts to centavos) ──

export async function createCheckout(
  e: PaymentEnv,
  p: { amount: number; name: string; description: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> },
): Promise<{ checkoutUrl: string; checkoutId: string }> {
  return call(e, "post", "/checkouts", p);
}

export interface CheckoutState {
  state: "paid" | "expired" | "open";
  /** The checkout's amount in pesos, as PayMongo has it. */
  amount: number;
  paymentId?: string;
  referenceNo?: string;
  livemode: boolean;
}

export async function getCheckout(e: PaymentEnv, checkoutId: string): Promise<CheckoutState> {
  return call(e, "get", `/checkouts/${encodeURIComponent(checkoutId)}`, undefined, 15_000);
}

export async function expireCheckout(e: PaymentEnv, checkoutId: string): Promise<void> {
  await call(e, "post", `/checkouts/${encodeURIComponent(checkoutId)}/expire`, {}, 15_000);
}

export async function refund(e: PaymentEnv, p: { paymentId: string; amount: number; reason: string }): Promise<{ refundId: string; status: string }> {
  return call(e, "post", "/refunds", p);
}

export async function institutions(e: PaymentEnv, provider: "instapay" | "pesonet"): Promise<Array<{ providerCode: string; name: string }>> {
  const out = await call<{ data: Array<{ providerCode: string; name: string }> }>(e, "get", `/transfers/institutions?provider=${provider}`);
  return out?.data ?? [];
}

/** True only when the gateway positively reports a PayMongo wallet to send from. Anything else: manual payouts. */
export async function walletReady(e: PaymentEnv): Promise<boolean> {
  try {
    const s = await call<{ walletReady?: boolean | null }>(e, "get", "/status", undefined, 15_000);
    return s?.walletReady === true;
  } catch (err) {
    logger.warn(`[GATEWAY] ${e} /status failed: ${(err as Error).message}`);
    return false;
  }
}

export async function transfer(
  e: PaymentEnv,
  p: { provider: "instapay" | "pesonet"; amount: number; destination: { number: string; name: string; bic: string }; referenceNumber: string; purpose: string },
): Promise<{ transferId: string; status: string }> {
  return call(e, "post", "/transfers", p);
}

// ── gateway -> main API events (POST /payments/gateway-event) ──────────────────

export const FORWARD_MAX_AGE_MS = 5 * 60_000;
const FORWARD_MAX_SKEW_MS = 60_000;

/**
 * The gateway signs every forwarded webhook event with its token:
 * `X-Gateway-Signature = hex(HMAC-SHA256(token, ts + "." + rawBody))`, `ts` in
 * ms (server/payment_gateway/src/signature.ts signForward). An event older than
 * 5 minutes is refused, so a captured event can't be replayed later.
 * Returns null when valid, otherwise why not.
 */
export function verifyGatewayEvent(e: PaymentEnv, rawBody: string, tsHeader: string | undefined, sigHeader: string | undefined, now = Date.now()): string | null {
  const t = target(e);
  if (!t) return `the ${e} gateway is not configured here`;
  if (!tsHeader || !sigHeader) return "missing signature headers";
  if (!/^\d{10,16}$/.test(tsHeader)) return "bad timestamp";
  const ts = Number(tsHeader);
  if (now - ts > FORWARD_MAX_AGE_MS) return "event is older than 5 minutes";
  if (ts - now > FORWARD_MAX_SKEW_MS) return "event timestamp is in the future";
  if (!/^[0-9a-f]{64}$/i.test(sigHeader)) return "bad signature";
  const want = crypto.createHmac("sha256", t.token).update(`${tsHeader}.${rawBody}`).digest("hex");
  const a = Buffer.from(want, "utf8");
  const b = Buffer.from(sigHeader.toLowerCase(), "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "bad signature";
  return null;
}

/** Same money in pesos, compared in whole centavos (floats from the DB and from /100). */
export function sameAmount(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a * 100) === Math.round(b * 100);
}

/**
 * For the admin system-health page: what new payments use right now, and
 * whether that gateway is awake and the mode it claims to be. Waking it is a
 * side effect (a sleeping gateway is woken by the check itself).
 */
export async function describeGateway(timeoutMs = 5_000): Promise<{ ok: boolean; detail: string }> {
  const leftover = env.PAYMONGO_SECRET_KEY ? " PAYMONGO_SECRET_KEY is still in the API's .env and unused: remove it (SPEC §8.5)." : "";
  if (env.PAYMENT_MODE === "MANUAL") {
    return { ok: true, detail: `PAYMENT_MODE=MANUAL: every payment is manual (GCash, admin confirms). No gateway is used for new payments.${leftover}` };
  }
  const g = env.PAYMENT_GATEWAY;
  if (g !== "sandbox" && g !== "live") {
    return { ok: false, detail: `PAYMENT_GATEWAY is not set (sandbox or live): every payment falls back to manual.${leftover}` };
  }
  if (!gatewayConfigured(g)) {
    return { ok: false, detail: `PAYMENT_GATEWAY=${g} but PAYMENT_GATEWAY_${g.toUpperCase()}_URL / _TOKEN (32+ chars) are not set: every payment falls back to manual.${leftover}` };
  }
  try {
    const h = await assertGatewayMode(g, timeoutMs);
    return { ok: true, detail: `${g === "live" ? "LIVE" : "Sandbox (TEST mode, no real money)"} gateway awake: mode ${h.mode}, key ${h.keyMode}, webhook ${h.webhookConfigured ? "configured" : "NOT configured"}, v${h.version ?? "?"}.${leftover}` };
  } catch (err) {
    if (err instanceof GatewayWaking) {
      return { ok: false, detail: `The ${g} gateway did not answer in ${timeoutMs / 1000} s: asleep or waking (free Render, about a minute). This check woke it; try again shortly.${leftover}` };
    }
    return { ok: false, detail: `${(err as Error).message}${leftover}` };
  }
}
