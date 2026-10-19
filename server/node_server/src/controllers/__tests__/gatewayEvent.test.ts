import crypto from "crypto";
import express from "express";
import request from "supertest";
import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * P2.6: POST /payments/gateway-event, end to end through the real JSON parser
 * (with keepRawBody), the real payment routes and the real HMAC check. Only the
 * DB and the HTTP call to the gateway are mocked. SPEC §6: an event decides
 * nothing by itself; PayMongo's own answer for the transaction's own gateway
 * does. Each guard was removed once and a test here failed (PROGRESS.md P2).
 */

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("axios");
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../../services/paymentConfirmationService", () => ({
  markTransactionPaid: jest.fn().mockResolvedValue({ status: "confirmed" }),
  markTransactionFailed: jest.fn().mockResolvedValue(undefined),
}));

import axios from "axios";
import prisma from "../../config/database";
import env from "../../config/env";
import paymentRoutes from "../../routes/paymentRoutes";
import { keepRawBody } from "../../utils/rawBody";
import { markTransactionPaid } from "../../services/paymentConfirmationService";

const db = prisma as unknown as DeepMockProxy<PrismaClient>;
const ax = axios as jest.Mocked<typeof axios>;
const E = env as any;
const SANDBOX = "s".repeat(40);
const LIVE = "l".repeat(40);
const KEYS = ["PAYMENT_MODE", "PAYMENT_GATEWAY", "PAYMENT_GATEWAY_SANDBOX_URL", "PAYMENT_GATEWAY_SANDBOX_TOKEN", "PAYMENT_GATEWAY_LIVE_URL", "PAYMENT_GATEWAY_LIVE_TOKEN"];
const saved: Record<string, unknown> = {};

const app = express();
app.use(express.json({ limit: "10mb", verify: keepRawBody }));
app.use("/api/v1/payments", paymentRoutes);

const URL = "/api/v1/payments/gateway-event";
const event = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ mode: "sandbox", eventId: "evt_1", type: "checkout_session.payment.paid", livemode: false, checkoutId: "cs_1", ...over });
const sign = (token: string, ts: number, body: string) => crypto.createHmac("sha256", token).update(`${ts}.${body}`).digest("hex");

function send(body: string, opts: { token?: string; ts?: number; sig?: string | null } = {}) {
  const ts = opts.ts ?? Date.now();
  const r = request(app).post(URL).set("Content-Type", "application/json").set("X-Gateway-Timestamp", String(ts));
  const sig = opts.sig === undefined ? sign(opts.token ?? SANDBOX, ts, body) : opts.sig;
  if (sig !== null) r.set("X-Gateway-Signature", sig);
  return r.send(body);
}

const tx = (over: Record<string, unknown> = {}) =>
  ({ id: "tx-1", status: "PENDING", amount: 400, paymongoCheckoutId: "cs_1", paymentEnv: "sandbox", ...over }) as never;
const payMongoSays = (data: Record<string, unknown>) => ax.request.mockResolvedValue({ data: { livemode: false, ...data } });

beforeEach(() => {
  for (const k of KEYS) saved[k] = E[k];
  mockReset(db);
  ax.request.mockReset();
  (markTransactionPaid as jest.Mock).mockClear();
  E.PAYMENT_MODE = "PAYMONGO";
  E.PAYMENT_GATEWAY = "sandbox";
  E.PAYMENT_GATEWAY_SANDBOX_URL = "https://pay-sandbox.example";
  E.PAYMENT_GATEWAY_SANDBOX_TOKEN = SANDBOX;
  E.PAYMENT_GATEWAY_LIVE_URL = "https://pay-live.example";
  E.PAYMENT_GATEWAY_LIVE_TOKEN = LIVE;
});
afterEach(() => {
  for (const k of KEYS) E[k] = saved[k];
});

describe("gateway-event: valid events still need PayMongo's own word", () => {
  it("signed, fresh, PayMongo says paid for the same amount -> confirmed", async () => {
    db.transaction.findUnique.mockResolvedValue(tx());
    payMongoSays({ state: "paid", amount: 400, paymentId: "pay_1", referenceNo: "R1" });
    const res = await send(event());
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("paid");
    expect((ax.request.mock.calls[0][0] as any).url).toBe("https://pay-sandbox.example/checkouts/cs_1");
    expect(markTransactionPaid).toHaveBeenCalledWith(undefined, "tx-1", expect.objectContaining({ via: "PAYMONGO_WEBHOOK", paymentId: "pay_1" }));
  });

  it("verifies the bytes as sent (whitespace kept), not a re-serialised body", async () => {
    db.transaction.findUnique.mockResolvedValue(tx());
    payMongoSays({ state: "paid", amount: 400, paymentId: "pay_1" });
    const spaced = event().replace(/,/g, ", ");
    const res = await send(spaced);
    expect(res.status).toBe(200);
  });

  it("PayMongo says still open -> not confirmed", async () => {
    db.transaction.findUnique.mockResolvedValue(tx());
    payMongoSays({ state: "open", amount: 400 });
    const res = await send(event());
    expect(res.body.outcome).toBe("open");
    expect(markTransactionPaid).not.toHaveBeenCalled();
  });

  it("PayMongo says paid but for a different amount -> not confirmed", async () => {
    db.transaction.findUnique.mockResolvedValue(tx());
    payMongoSays({ state: "paid", amount: 4, paymentId: "pay_1" });
    const res = await send(event());
    expect(res.body.outcome).toBe("amount_mismatch");
    expect(markTransactionPaid).not.toHaveBeenCalled();
  });

  it("the same event twice: the second finds it done and changes nothing (idempotent)", async () => {
    payMongoSays({ state: "paid", amount: 400, paymentId: "pay_1" });
    db.transaction.findUnique.mockResolvedValueOnce(tx()).mockResolvedValueOnce(tx()); // route + confirm
    const body = event();
    const ts = Date.now();
    await send(body, { ts });
    db.transaction.findUnique.mockResolvedValue(tx({ status: "COMPLETED" }));
    const again = await send(body, { ts });
    expect(again.body.outcome).toBe("skip");
    expect(markTransactionPaid).toHaveBeenCalledTimes(1);
  });

  it("a sandbox event can never touch a live transaction", async () => {
    db.transaction.findUnique.mockResolvedValue(tx({ paymentEnv: "live" }));
    const res = await send(event());
    expect(res.status).toBe(409);
    expect(ax.request).not.toHaveBeenCalled();
  });

  it("a live event, signed with the LIVE token, for a live row -> asked on the live gateway", async () => {
    db.transaction.findUnique.mockResolvedValue(tx({ paymentEnv: "live" }));
    ax.request.mockResolvedValue({ data: { state: "paid", amount: 400, paymentId: "pay_1", livemode: true } });
    const res = await send(event({ mode: "live", livemode: true }), { token: LIVE });
    expect(res.status).toBe(200);
    expect((ax.request.mock.calls[0][0] as any).url).toBe("https://pay-live.example/checkouts/cs_1");
  });

  it("no checkout id (e.g. payment.paid) -> 202, nothing looked up", async () => {
    const res = await send(event({ checkoutId: undefined, type: "payment.paid" }));
    expect(res.status).toBe(202);
    expect(db.transaction.findUnique).not.toHaveBeenCalled();
  });

  it("an unknown checkout -> 404", async () => {
    db.transaction.findUnique.mockResolvedValue(null as never);
    const res = await send(event());
    expect(res.status).toBe(404);
  });
});

describe("gateway-event: refused before anything is looked up", () => {
  afterEach(() => {
    expect(db.transaction.findUnique).not.toHaveBeenCalled();
    expect(markTransactionPaid).not.toHaveBeenCalled();
  });

  it("no signature -> 401", async () => {
    expect((await send(event(), { sig: null })).status).toBe(401);
  });
  it("signed with the other mode's token -> 401", async () => {
    expect((await send(event(), { token: LIVE })).status).toBe(401);
  });
  it("older than 5 minutes (a replay) -> 401", async () => {
    expect((await send(event(), { ts: Date.now() - 6 * 60_000 })).status).toBe(401);
  });
  it("body changed after signing -> 401", async () => {
    const ts = Date.now();
    const sig = sign(SANDBOX, ts, event());
    expect((await send(event({ checkoutId: "cs_other" }), { ts, sig })).status).toBe(401);
  });
  it("no mode -> 400", async () => {
    expect((await send(event({ mode: undefined }))).status).toBe(400);
  });
  it("that mode's gateway is not configured here -> 401", async () => {
    E.PAYMENT_GATEWAY_SANDBOX_TOKEN = "";
    expect((await send(event())).status).toBe(401);
  });
});
