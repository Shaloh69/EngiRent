import request from "supertest";
import { createApp, eventFromPayload } from "../app";
import type { Config } from "../config";
import type { Forwarder, ForwardEvent } from "../forward";
import type { PayMongo } from "../paymongo";
import { hmacHex } from "../signature";

const TOKEN = "g".repeat(40);
const WH = "whsk_secret";

function cfg(over: Partial<Config> = {}): Config {
  return {
    env: "sandbox",
    paymongoSecretKey: "sk_test_SECRETKEYVALUE",
    webhookSecret: WH,
    gatewayToken: TOKEN,
    endpointGistUrl: "https://gist.example/raw",
    mainApiUrl: "",
    sourceAccount: null,
    port: 0,
    ...over,
  };
}

function fakePm(): jest.Mocked<PayMongo> {
  return {
    createCheckout: jest.fn().mockResolvedValue({ checkoutUrl: "https://checkout.paymongo.com/cs_1", checkoutId: "cs_1" }),
    getCheckout: jest.fn().mockResolvedValue({ state: "paid", amount: 150, paymentId: "pay_1", livemode: false }),
    expireCheckout: jest.fn().mockResolvedValue(undefined),
    refund: jest.fn().mockResolvedValue({ refundId: "ref_1", status: "pending" }),
    institutions: jest.fn().mockResolvedValue([{ providerCode: "GXCHPHM2XXX", name: "GCash" }]),
    transfer: jest.fn().mockResolvedValue({ transferId: "tr_1", status: "pending" }),
    walletReady: jest.fn().mockResolvedValue(false),
  };
}

function fakeFwd() {
  const sent: ForwardEvent[] = [];
  const f: Forwarder = {
    forward: jest.fn(async (ev: ForwardEvent) => {
      sent.push(ev);
      return { ok: true, status: 200 };
    }),
    currentMainApi: jest.fn().mockResolvedValue("https://api.example/api/v1"),
  };
  return { f, sent };
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const flush = () => new Promise((r) => setImmediate(r));

function signed(body: string, mode: "te" | "li" = "te", secret = WH) {
  const t = "1700000000";
  const s = hmacHex(secret, `${t}.${body}`);
  return mode === "te" ? `t=${t},te=${s},li=` : `t=${t},te=,li=${s}`;
}

const paidEvent = (livemode = false) =>
  JSON.stringify({
    data: {
      id: "evt_9",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode,
        data: { id: "cs_42", type: "checkout_session", attributes: { payments: [{ id: "pay_42" }] } },
      },
    },
  });

describe("health (public, no secrets)", () => {
  it("reports mode and configuration, never a key", async () => {
    const res = await request(createApp(cfg(), fakePm(), fakeFwd().f, () => {})).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: "sandbox", keyMode: "test", webhookConfigured: true, transfersConfigured: false });
    expect(JSON.stringify(res.body)).not.toContain("SECRETKEYVALUE");
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});

describe("token protection", () => {
  const app = createApp(cfg(), fakePm(), fakeFwd().f, () => {});
  it.each([
    ["no header", {}],
    ["wrong token", { Authorization: `Bearer ${"x".repeat(40)}` }],
    ["token prefix only", { Authorization: `Bearer ${TOKEN.slice(0, 20)}` }],
    ["not Bearer", { Authorization: TOKEN }],
  ])("%s gets 401 and PayMongo is never called", async (_l, headers) => {
    const pm = fakePm();
    const a = createApp(cfg(), pm, fakeFwd().f, () => {});
    const res = await request(a).post("/checkouts").set(headers as Record<string, string>).send({ amount: 100 });
    expect(res.status).toBe(401);
    expect(pm.createCheckout).not.toHaveBeenCalled();
  });
  it("the right token passes", async () => {
    expect((await request(app).get("/checkouts/cs_1").set(auth)).status).toBe(200);
  });
});

describe("checkouts", () => {
  const good = { amount: 150, name: "Rent", description: "Calculator, 3 days", successUrl: "https://x/ok", cancelUrl: "https://x/no", metadata: { rentalId: "r1" } };
  it("creates with validated input", async () => {
    const pm = fakePm();
    const res = await request(createApp(cfg(), pm, fakeFwd().f, () => {})).post("/checkouts").set(auth).send(good);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ checkoutUrl: "https://checkout.paymongo.com/cs_1", checkoutId: "cs_1" });
    expect(pm.createCheckout).toHaveBeenCalledWith(good);
  });
  it.each([
    ["zero amount", { amount: 0 }],
    ["negative amount", { amount: -5 }],
    ["string amount", { amount: "150" }],
    ["three decimals", { amount: 1.005 }],
    ["centavos sent as pesos", { amount: 1_500_000 }],
    ["http success URL", { successUrl: "http://x/ok" }],
    ["missing name", { name: "" }],
    ["non-string metadata", { metadata: { n: 1 } }],
  ])("refuses %s with 400 and never calls PayMongo", async (_l, patch) => {
    const pm = fakePm();
    const res = await request(createApp(cfg(), pm, fakeFwd().f, () => {})).post("/checkouts").set(auth).send({ ...good, ...patch });
    expect(res.status).toBe(400);
    expect(pm.createCheckout).not.toHaveBeenCalled();
  });
  it("a checkout from the other mode is refused (409), not reported as paid", async () => {
    const pm = fakePm();
    pm.getCheckout.mockResolvedValue({ state: "paid", amount: 150, livemode: true });
    const res = await request(createApp(cfg(), pm, fakeFwd().f, () => {})).get("/checkouts/cs_1").set(auth);
    expect(res.status).toBe(409);
  });
  it("an id with path characters is refused", async () => {
    const pm = fakePm();
    const res = await request(createApp(cfg(), pm, fakeFwd().f, () => {})).get("/checkouts/cs_1%2F..%2Frefunds").set(auth);
    expect(res.status).toBe(400);
    expect(pm.getCheckout).not.toHaveBeenCalled();
  });
  it("a PayMongo error comes back as 502 with PayMongo's own errors, never the key", async () => {
    const pm = fakePm();
    pm.createCheckout.mockRejectedValue({ response: { status: 401, data: { errors: [{ code: "authentication_failed" }] } }, config: { headers: { Authorization: "Basic SECRETKEYVALUE" } } });
    const res = await request(createApp(cfg(), pm, fakeFwd().f, () => {})).post("/checkouts").set(auth).send(good);
    expect(res.status).toBe(502);
    expect(res.body.paymongoStatus).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("SECRETKEYVALUE");
  });
});

describe("refunds and transfers", () => {
  it("refund validates the payment id and amount", async () => {
    const pm = fakePm();
    const app = createApp(cfg(), pm, fakeFwd().f, () => {});
    expect((await request(app).post("/refunds").set(auth).send({ paymentId: "pay_1", amount: 50 })).status).toBe(201);
    expect(pm.refund).toHaveBeenCalledWith({ paymentId: "pay_1", amount: 50, reason: "others" });
    expect((await request(app).post("/refunds").set(auth).send({ paymentId: "../x", amount: 50 })).status).toBe(400);
  });
  it("transfers are refused while no source wallet is configured (PayMongo requires one)", async () => {
    const pm = fakePm();
    const res = await request(createApp(cfg(), pm, fakeFwd().f, () => {})).post("/transfers").set(auth).send({});
    expect(res.status).toBe(409);
    expect(pm.transfer).not.toHaveBeenCalled();
  });
  it("with a wallet configured, the transfer always uses it as the source", async () => {
    const pm = fakePm();
    const source = { number: "W1", name: "EngiRent", bic: "PAEYPHM2XXX" };
    const app = createApp(cfg({ sourceAccount: source }), pm, fakeFwd().f, () => {});
    const res = await request(app)
      .post("/transfers")
      .set(auth)
      .send({ provider: "instapay", amount: 200, destination: { number: "0917", name: "Omar", bic: "GXCHPHM2XXX" }, referenceNumber: "ER-PAY-1" });
    expect(res.status).toBe(201);
    expect(pm.transfer.mock.calls[0][0]).toMatchObject({ source, amount: 200, referenceNumber: "ERPAY1" });
  });
  it("institutions need a valid provider", async () => {
    const app = createApp(cfg(), fakePm(), fakeFwd().f, () => {});
    expect((await request(app).get("/transfers/institutions?provider=instapay").set(auth)).body.data[0].name).toBe("GCash");
    expect((await request(app).get("/transfers/institutions?provider=gcash").set(auth)).status).toBe(400);
  });
});

describe("webhook", () => {
  it("a correctly signed sandbox event is answered 200 and forwarded", async () => {
    const { f, sent } = fakeFwd();
    const body = paidEvent(false);
    const res = await request(createApp(cfg(), fakePm(), f, () => {}))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", signed(body))
      .send(body);
    expect(res.status).toBe(200);
    await flush();
    expect(sent).toEqual([{ mode: "sandbox", eventId: "evt_9", type: "checkout_session.payment.paid", livemode: false, checkoutId: "cs_42", paymentId: "pay_42" }]);
  });
  it("a bad signature is 400 and nothing is forwarded", async () => {
    const { f, sent } = fakeFwd();
    const body = paidEvent(false);
    const res = await request(createApp(cfg(), fakePm(), f, () => {}))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", signed(body, "te", "wrong"))
      .send(body);
    expect(res.status).toBe(400);
    await flush();
    expect(sent).toHaveLength(0);
  });
  it("a live-signed event is rejected by the sandbox gateway", async () => {
    const { f, sent } = fakeFwd();
    const body = paidEvent(true);
    const res = await request(createApp(cfg(), fakePm(), f, () => {}))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", signed(body, "li"))
      .send(body);
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
  it("a signed event whose livemode does not match the gateway is answered 200 but NOT forwarded", async () => {
    const { f, sent } = fakeFwd();
    const body = paidEvent(true);
    const res = await request(createApp(cfg(), fakePm(), f, () => {}))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", signed(body, "te"))
      .send(body);
    expect(res.status).toBe(200);
    await flush();
    expect(sent).toHaveLength(0);
  });
  it("answers 200 even when the main API cannot be reached (PayMongo must not disable the webhook)", async () => {
    const f: Forwarder = { forward: jest.fn().mockResolvedValue({ ok: false, reason: "main API unreachable" }), currentMainApi: jest.fn() };
    const body = paidEvent(false);
    const res = await request(createApp(cfg(), fakePm(), f, () => {}))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", signed(body))
      .send(body);
    expect(res.status).toBe(200);
  });
  it("without a webhook secret it answers 503 and forwards nothing", async () => {
    const { f, sent } = fakeFwd();
    const body = paidEvent(false);
    const res = await request(createApp(cfg({ webhookSecret: "" }), fakePm(), f, () => {}))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", signed(body))
      .send(body);
    expect(res.status).toBe(503);
    expect(sent).toHaveLength(0);
  });
  it("does not need the gateway token (PayMongo cannot send one)", async () => {
    const body = paidEvent(false);
    const res = await request(createApp(cfg(), fakePm(), fakeFwd().f, () => {}))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Paymongo-Signature", signed(body))
      .send(body);
    expect(res.status).toBe(200);
  });
});

describe("eventFromPayload", () => {
  it("reads a payment event", () => {
    expect(
      eventFromPayload("live", { data: { id: "evt_1", attributes: { type: "payment.paid", livemode: true, data: { id: "pay_7", type: "payment" } } } }),
    ).toEqual({ mode: "live", eventId: "evt_1", type: "payment.paid", livemode: true, paymentId: "pay_7" });
  });
  it("ignores a payload without a resource", () => {
    expect(eventFromPayload("sandbox", { data: { attributes: { type: "x" } } })).toBeNull();
  });
});
