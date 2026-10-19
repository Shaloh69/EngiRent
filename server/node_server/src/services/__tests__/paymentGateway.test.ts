import crypto from "crypto";

jest.mock("axios");
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import axios from "axios";
import env from "../../config/env";
import {
  activeEnv,
  assertGatewayMode,
  describeGateway,
  envOf,
  GatewayUnavailable,
  GatewayWaking,
  health,
  refund,
  sameAmount,
  verifyGatewayEvent,
  wake,
  walletReady,
  WAKING_MESSAGE,
} from "../paymentGateway";

// SPEC-PAYMENT-GATEWAY.md §3.2 / §6, P2.1. Each guard here was removed once and
// a test below failed (PROGRESS.md P2 mutation log).

const ax = axios as jest.Mocked<typeof axios>;
const E = env as any;
const SANDBOX_TOKEN = "s".repeat(40);
const LIVE_TOKEN = "l".repeat(40);
const saved: Record<string, unknown> = {};
const KEYS = ["PAYMENT_MODE", "PAYMENT_GATEWAY", "PAYMENT_GATEWAY_SANDBOX_URL", "PAYMENT_GATEWAY_SANDBOX_TOKEN", "PAYMENT_GATEWAY_LIVE_URL", "PAYMENT_GATEWAY_LIVE_TOKEN"];

beforeEach(() => {
  for (const k of KEYS) saved[k] = E[k];
  E.PAYMENT_MODE = "PAYMONGO";
  E.PAYMENT_GATEWAY = "sandbox";
  E.PAYMENT_GATEWAY_SANDBOX_URL = "https://pay-sandbox.example/";
  E.PAYMENT_GATEWAY_SANDBOX_TOKEN = SANDBOX_TOKEN;
  E.PAYMENT_GATEWAY_LIVE_URL = "https://pay-live.example";
  E.PAYMENT_GATEWAY_LIVE_TOKEN = LIVE_TOKEN;
  ax.get.mockReset();
  ax.request.mockReset();
});
afterEach(() => {
  for (const k of KEYS) E[k] = saved[k];
});

describe("activeEnv: which gateway new payments use", () => {
  it("is the configured PAYMENT_GATEWAY", () => {
    expect(activeEnv()).toBe("sandbox");
    E.PAYMENT_GATEWAY = "live";
    expect(activeEnv()).toBe("live");
  });
  it("is null under PAYMENT_MODE=MANUAL even with the live gateway set (kill switch, §6)", () => {
    E.PAYMENT_MODE = "MANUAL";
    E.PAYMENT_GATEWAY = "live";
    expect(activeEnv()).toBeNull();
  });
  it("is null when the chosen gateway has no URL or a short token", () => {
    E.PAYMENT_GATEWAY_SANDBOX_TOKEN = "short";
    expect(activeEnv()).toBeNull();
    E.PAYMENT_GATEWAY_SANDBOX_TOKEN = SANDBOX_TOKEN;
    E.PAYMENT_GATEWAY_SANDBOX_URL = "";
    expect(activeEnv()).toBeNull();
  });
  it("is null when PAYMENT_GATEWAY is unset", () => {
    E.PAYMENT_GATEWAY = undefined;
    expect(activeEnv()).toBeNull();
  });
});

describe("envOf: an existing transaction keeps its own gateway", () => {
  it("uses the recorded paymentEnv", () => {
    expect(envOf({ paymentEnv: "live", paymongoCheckoutId: "cs_1" })).toBe("live");
    expect(envOf({ paymentEnv: "sandbox" })).toBe("sandbox");
  });
  it("treats a pre-P2 PayMongo row as sandbox (only the TEST key was ever installed)", () => {
    expect(envOf({ paymentEnv: null, paymongoCheckoutId: "cs_1" })).toBe("sandbox");
    expect(envOf({ paymentEnv: null, paymongoPaymentId: "pay_1" })).toBe("sandbox");
  });
  it("never guesses for a manual row or an unknown value", () => {
    expect(envOf({ paymentEnv: null })).toBeNull();
    expect(envOf({ paymentEnv: "prod", paymongoCheckoutId: "cs_1" })).toBeNull();
  });
});

describe("assertGatewayMode: refuse a payment on the wrong gateway", () => {
  it("passes when mode and key kind match", async () => {
    ax.get.mockResolvedValue({ data: { mode: "sandbox", keyMode: "test" } });
    await expect(assertGatewayMode("sandbox")).resolves.toMatchObject({ mode: "sandbox" });
    expect(ax.get).toHaveBeenCalledWith("https://pay-sandbox.example/health", expect.anything());
  });
  it("refuses when the sandbox URL actually points at the live gateway", async () => {
    ax.get.mockResolvedValue({ data: { mode: "live", keyMode: "live" } });
    await expect(assertGatewayMode("sandbox")).rejects.toBeInstanceOf(GatewayUnavailable);
  });
  it("refuses a gateway that reports another mode even when the key kind matches", async () => {
    ax.get.mockResolvedValue({ data: { mode: "staging", keyMode: "test" } });
    await expect(assertGatewayMode("sandbox")).rejects.toThrow(/mismatch/);
  });
  it("refuses a 'live' gateway that is running a test key", async () => {
    ax.get.mockResolvedValue({ data: { mode: "live", keyMode: "test" } });
    await expect(assertGatewayMode("live")).rejects.toThrow(/mismatch/);
  });
  it("refuses when the gateway is not configured", async () => {
    E.PAYMENT_GATEWAY_LIVE_URL = "";
    await expect(assertGatewayMode("live")).rejects.toBeInstanceOf(GatewayUnavailable);
    expect(ax.get).not.toHaveBeenCalled();
  });
});

describe("health: a sleeping gateway is 'waking', a wrong one is 'unavailable'", () => {
  it("timeout -> GatewayWaking with the SPEC §5 copy", async () => {
    ax.get.mockRejectedValue(Object.assign(new Error("timeout of 8000ms exceeded"), { code: "ECONNABORTED" }));
    const err = await health("sandbox").catch((e) => e);
    expect(err).toBeInstanceOf(GatewayWaking);
    expect(err.message).toBe(WAKING_MESSAGE);
  });
  it("502 while Render boots it -> GatewayWaking", async () => {
    ax.get.mockRejectedValue({ response: { status: 502 } });
    await expect(health("sandbox")).rejects.toBeInstanceOf(GatewayWaking);
  });
  it("404 (wrong URL) -> GatewayUnavailable, not an endless 'waking'", async () => {
    ax.get.mockRejectedValue({ response: { status: 404 } });
    await expect(health("sandbox")).rejects.toBeInstanceOf(GatewayUnavailable);
  });
});

describe("wake: fire and forget", () => {
  it("pings the active gateway's /health and returns without waiting", () => {
    ax.get.mockReturnValue(new Promise(() => undefined) as never); // never resolves
    expect(wake()).toBeUndefined();
    expect(ax.get).toHaveBeenCalledWith("https://pay-sandbox.example/health", expect.anything());
  });
  it("never throws, even when axios throws synchronously or rejects", async () => {
    ax.get.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => wake()).not.toThrow();
    ax.get.mockRejectedValue(new Error("down"));
    expect(() => wake()).not.toThrow();
    await new Promise((r) => setImmediate(r)); // an unhandled rejection would fail the run
  });
  it("does nothing under the kill switch", () => {
    E.PAYMENT_MODE = "MANUAL";
    wake();
    expect(ax.get).not.toHaveBeenCalled();
  });
});

describe("actions go to the named gateway with its own token", () => {
  it("a sandbox refund goes to the sandbox URL with the sandbox token, even while live is active", async () => {
    E.PAYMENT_GATEWAY = "live";
    ax.request.mockResolvedValue({ data: { refundId: "ref_1", status: "pending" } });
    await refund("sandbox", { paymentId: "pay_1", amount: 100, reason: "others" });
    const req = ax.request.mock.calls[0][0] as any;
    expect(req.url).toBe("https://pay-sandbox.example/refunds");
    expect(req.headers.Authorization).toBe(`Bearer ${SANDBOX_TOKEN}`);
  });
});

describe("walletReady: payouts stay manual unless the gateway says true", () => {
  it.each([
    [{ walletReady: true }, true],
    [{ walletReady: false }, false],
    [{ walletReady: null }, false],
    [{}, false],
  ])("%j -> %s", async (data, want) => {
    ax.request.mockResolvedValue({ data });
    await expect(walletReady("sandbox")).resolves.toBe(want);
  });
  it("an error -> false", async () => {
    ax.request.mockRejectedValue(new Error("down"));
    await expect(walletReady("sandbox")).resolves.toBe(false);
  });
});

describe("verifyGatewayEvent: X-Gateway-Signature = HMAC(token, ts.body), 5-minute window", () => {
  const body = JSON.stringify({ mode: "sandbox", type: "checkout_session.payment.paid", checkoutId: "cs_abc" });
  const now = 1_760_000_000_000;
  const sign = (token: string, ts: number, b = body) => crypto.createHmac("sha256", token).update(`${ts}.${b}`).digest("hex");

  it("accepts a fresh, correctly signed event", () => {
    expect(verifyGatewayEvent("sandbox", body, String(now), sign(SANDBOX_TOKEN, now), now)).toBeNull();
  });
  it("refuses the other mode's token", () => {
    expect(verifyGatewayEvent("sandbox", body, String(now), sign(LIVE_TOKEN, now), now)).toMatch(/signature/);
  });
  it("refuses a changed body", () => {
    expect(verifyGatewayEvent("sandbox", body.replace("cs_abc", "cs_xyz"), String(now), sign(SANDBOX_TOKEN, now), now)).toMatch(/signature/);
  });
  it("refuses a correctly signed event older than 5 minutes (replay)", () => {
    const old = now - 5 * 60_000 - 1;
    expect(verifyGatewayEvent("sandbox", body, String(old), sign(SANDBOX_TOKEN, old), now)).toMatch(/older/);
  });
  it("accepts one just inside the window", () => {
    const ts = now - 5 * 60_000 + 1000;
    expect(verifyGatewayEvent("sandbox", body, String(ts), sign(SANDBOX_TOKEN, ts), now)).toBeNull();
  });
  it("refuses a timestamp far in the future", () => {
    const ts = now + 10 * 60_000;
    expect(verifyGatewayEvent("sandbox", body, String(ts), sign(SANDBOX_TOKEN, ts), now)).toMatch(/future/);
  });
  it("refuses missing or malformed headers without throwing", () => {
    expect(verifyGatewayEvent("sandbox", body, undefined, sign(SANDBOX_TOKEN, now), now)).not.toBeNull();
    expect(verifyGatewayEvent("sandbox", body, String(now), undefined, now)).not.toBeNull();
    expect(verifyGatewayEvent("sandbox", body, "abc", sign(SANDBOX_TOKEN, now), now)).not.toBeNull();
    expect(verifyGatewayEvent("sandbox", body, String(now), "zz", now)).not.toBeNull();
  });
  it("refuses everything when that mode's gateway is not configured here", () => {
    E.PAYMENT_GATEWAY_SANDBOX_TOKEN = "";
    expect(verifyGatewayEvent("sandbox", body, String(now), sign("", now), now)).toMatch(/not configured/);
  });
});

describe("sameAmount", () => {
  it("compares in centavos", () => {
    expect(sameAmount(400, 400)).toBe(true);
    expect(sameAmount(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameAmount(400, 399.99)).toBe(false);
    expect(sameAmount(400, 40000)).toBe(false);
    expect(sameAmount(NaN, NaN)).toBe(false);
  });
});

describe("describeGateway (admin system health, P2.8)", () => {
  it("MANUAL is a healthy, deliberate state", async () => {
    E.PAYMENT_MODE = "MANUAL";
    await expect(describeGateway()).resolves.toMatchObject({ ok: true, detail: expect.stringMatching(/MANUAL/) });
    expect(ax.get).not.toHaveBeenCalled();
  });
  it("PAYMENT_GATEWAY unset is a fault", async () => {
    E.PAYMENT_GATEWAY = undefined;
    await expect(describeGateway()).resolves.toMatchObject({ ok: false });
  });
  it("chosen gateway without URL/token is a fault", async () => {
    E.PAYMENT_GATEWAY_SANDBOX_URL = "";
    await expect(describeGateway()).resolves.toMatchObject({ ok: false, detail: expect.stringMatching(/SANDBOX_URL/) });
  });
  it("awake and the right mode: ok, says TEST mode for the sandbox", async () => {
    ax.get.mockResolvedValue({ data: { mode: "sandbox", keyMode: "test", webhookConfigured: true, version: "0.1.0" } });
    await expect(describeGateway()).resolves.toMatchObject({ ok: true, detail: expect.stringMatching(/TEST mode/) });
  });
  it("wrong mode: a fault naming the mismatch", async () => {
    ax.get.mockResolvedValue({ data: { mode: "live", keyMode: "live" } });
    await expect(describeGateway()).resolves.toMatchObject({ ok: false, detail: expect.stringMatching(/mismatch/) });
  });
  it("asleep: a fault that says it is waking", async () => {
    ax.get.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    await expect(describeGateway()).resolves.toMatchObject({ ok: false, detail: expect.stringMatching(/asleep or waking/) });
  });
  it("a PayMongo key left in the API's .env is called out", async () => {
    const k = E.PAYMONGO_SECRET_KEY;
    E.PAYMONGO_SECRET_KEY = "sk_test_x";
    E.PAYMENT_MODE = "MANUAL";
    await expect(describeGateway()).resolves.toMatchObject({ detail: expect.stringMatching(/remove it/) });
    E.PAYMONGO_SECRET_KEY = k;
  });
});
