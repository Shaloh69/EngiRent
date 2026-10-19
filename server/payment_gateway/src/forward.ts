import axios, { AxiosInstance } from "axios";
import type { Config, PaymentEnv } from "./config";
import { signForward } from "./signature";

/**
 * Passes a verified PayMongo event on to the main API, wherever it is today.
 *
 * The main API sits behind a Cloudflare quick tunnel whose hostname changes on
 * every restart; its current base is published in the endpoint gist (the same
 * one the app reads, updated on every rehost). The URL is cached for 5 min and
 * re-read once when a forward fails.
 *
 * A failed forward is NOT an error toward PayMongo (the webhook has already
 * been answered 200): the main API's poller asks the gateway about every
 * pending checkout and confirms it anyway (SPEC §4). Forwarding only makes a
 * confirmation faster.
 */

export interface ForwardEvent {
  mode: PaymentEnv;
  eventId: string;
  type: string;
  livemode: boolean;
  checkoutId?: string;
  paymentId?: string;
}

export interface Forwarder {
  forward(ev: ForwardEvent): Promise<{ ok: boolean; status?: number; reason?: string }>;
  /** For /status: the main API base the gateway would use now, if known. */
  currentMainApi(): Promise<string | null>;
}

const CACHE_MS = 5 * 60_000;

export function createForwarder(cfg: Config, http: AxiosInstance = axios.create({ timeout: 15_000 }), now = () => Date.now()): Forwarder {
  let cached: { url: string; at: number } | null = null;

  async function resolve(fresh: boolean): Promise<string | null> {
    if (cfg.mainApiUrl) return cfg.mainApiUrl;
    if (!fresh && cached && now() - cached.at < CACHE_MS) return cached.url;
    try {
      const { data } = await http.get(cfg.endpointGistUrl, { headers: { "Cache-Control": "no-cache" } });
      const doc = typeof data === "string" ? JSON.parse(data) : data;
      const api = typeof doc?.api === "string" ? doc.api.trim().replace(/\/+$/, "") : "";
      if (!/^https:\/\//.test(api)) return cached?.url ?? null;
      cached = { url: api, at: now() };
      return api;
    } catch {
      return cached?.url ?? null;
    }
  }

  async function post(base: string, ev: ForwardEvent) {
    const body = JSON.stringify(ev);
    const ts = now();
    return http.post(`${base}/payments/gateway-event`, body, {
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Timestamp": String(ts),
        "X-Gateway-Signature": signForward(cfg.gatewayToken, body, ts),
      },
      validateStatus: () => true,
    });
  }

  return {
    async forward(ev) {
      for (const fresh of [false, true]) {
        const base = await resolve(fresh);
        if (!base) return { ok: false, reason: "main API address unknown" };
        try {
          const r = await post(base, ev);
          if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status };
          // A 4xx from a reachable API is an answer, not a stale address: don't retry.
          if (r.status < 500) return { ok: false, status: r.status, reason: "main API refused the event" };
        } catch {
          // network error: the tunnel may have rotated; retry once with a fresh address
        }
      }
      return { ok: false, reason: "main API unreachable" };
    },
    currentMainApi: () => resolve(false),
  };
}
