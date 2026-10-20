import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";

// Phase 0 fix under test: createPayment previously read `amount` straight
// from the request body ("You can pay ₱1 for a ₱5,000 rental" — C3 in the
// prior audit). It must now derive the charged amount entirely server-side
// from the rental record, and only for RENTAL_PAYMENT/SECURITY_DEPOSIT.

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("axios"); // avoid any real network call to PayMongo

// eslint-disable-next-line @typescript-eslint/no-var-requires
import prisma from "../../config/database";
import { createPayment, confirmPayment, createRefund, refundPayment } from "../paymentController";
import { _resetWaking } from "../../services/paymentGateway";
import { AuthRequest } from "../../middleware/auth";
import env from "../../config/env";
import crypto from "crypto";
import axios from "axios";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(body: Record<string, unknown>): AuthRequest {
  return {
    body,
    user: { userId: "renter-1", email: "a@b.com", studentId: "s1", role: "STUDENT" },
  } as unknown as AuthRequest;
}

describe("createPayment — server-side amount derivation (Phase 0 / C3)", () => {
  const realMode = (env as any).PAYMENT_MODE;
  beforeEach(() => {
    mockReset(prismaMock);
    // Deterministic: these pin the AMOUNT, not the rail, so they run on the
    // manual fallback whatever key the local .env holds.
    (env as any).PAYMENT_MODE = "MANUAL";
  });
  afterEach(() => {
    (env as any).PAYMENT_MODE = realMode;
  });

  it("ignores a client-supplied amount and charges the rental's real totalPrice", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      renterId: "renter-1",
      totalPrice: 5000,
      securityDeposit: 500,
      item: { title: "Laptop" },
    } as never);
    prismaMock.transaction.create.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: "txn-1", ...data }) as never,
    );

    const req = makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT", amount: 1 });
    const res = makeRes();
    const next = jest.fn();

    await createPayment(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const createCall = prismaMock.transaction.create.mock.calls[0][0] as any;
    // The attacker-supplied `amount: 1` must never reach the transaction —
    // the real rental.totalPrice (5000) must be what's actually charged.
    expect(createCall.data.amount).toBe(5000);
    expect(createCall.data.amount).not.toBe(1);
  });

  it("charges securityDeposit (not totalPrice) for a SECURITY_DEPOSIT payment", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      renterId: "renter-1",
      totalPrice: 5000,
      securityDeposit: 800,
      item: { title: "Laptop" },
    } as never);
    prismaMock.transaction.create.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: "txn-1", ...data }) as never,
    );

    const req = makeReq({ rentalId: "rental-1", type: "SECURITY_DEPOSIT", amount: 999999 });
    const res = makeRes();
    const next = jest.fn();

    await createPayment(req, res, next);

    const createCall = prismaMock.transaction.create.mock.calls[0][0] as any;
    expect(createCall.data.amount).toBe(800);
  });

  it("rejects a payment type outside RENTAL_PAYMENT/SECURITY_DEPOSIT (e.g. DAMAGE_FEE is system-only)", async () => {
    const req = makeReq({ rentalId: "rental-1", type: "DAMAGE_FEE", amount: 100 });
    const res = makeRes();
    const next = jest.fn();

    await createPayment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("rejects a payment for a rental the caller doesn't own", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      renterId: "someone-else",
      totalPrice: 5000,
      securityDeposit: 500,
      item: { title: "Laptop" },
    } as never);

    const req = makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT", amount: 5000 });
    const res = makeRes();
    const next = jest.fn();

    await createPayment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("rejects when the rental has no positive amount to charge for the requested type", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      renterId: "renter-1",
      totalPrice: 5000,
      securityDeposit: 0,
      item: { title: "Laptop" },
    } as never);

    const req = makeReq({ rentalId: "rental-1", type: "SECURITY_DEPOSIT", amount: 500 });
    const res = makeRes();
    const next = jest.fn();

    await createPayment(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });
});

// Phase 0 fix under test: confirmPayment previously trusted an unsigned/
// unverified webhook body, and an unset PAYMONGO_WEBHOOK_SECRET made
// verifyWebhookSignature() always return true. Both holes must stay closed —
// a real webhook payload is only ever honored with a valid HMAC signature.
describe("confirmPayment — webhook signature verification (Phase 0)", () => {
  const realSecret = env.PAYMONGO_WEBHOOK_SECRET;
  const realNodeEnv = env.NODE_ENV;

  afterEach(() => {
    (env as any).PAYMONGO_WEBHOOK_SECRET = realSecret;
    (env as any).NODE_ENV = realNodeEnv;
  });

  function webhookBody(transactionId: string) {
    return {
      data: {
        type: "checkout_session.payment.paid",
        attributes: {
          metadata: { transaction_id: transactionId },
          payment_intent: { id: "pi_1" },
          reference_number: "ref-1",
        },
      },
    };
  }

  function signBody(body: unknown, secret: string): string {
    const rawBody = JSON.stringify(body);
    const timestamp = "1700000000";
    const hash = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    return `t=${timestamp},te=${hash}`;
  }

  it("rejects a webhook-shaped payload with no signature header at all", async () => {
    (env as any).PAYMONGO_WEBHOOK_SECRET = "whsec_test";
    const req = {
      body: webhookBody("txn-1"),
      headers: {},
    } as unknown as Request;
    const res = makeRes();
    const next = jest.fn();

    await confirmPayment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.transaction.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a webhook with a tampered/incorrect signature", async () => {
    (env as any).PAYMONGO_WEBHOOK_SECRET = "whsec_test";
    const body = webhookBody("txn-1");
    const req = {
      body,
      headers: { "paymongo-signature": "t=1700000000,te=deadbeef" },
    } as unknown as Request;
    const res = makeRes();
    const next = jest.fn();

    await confirmPayment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.transaction.findUnique).not.toHaveBeenCalled();
  });

  it("rejects any webhook when PAYMONGO_WEBHOOK_SECRET is unset (fails closed, not open)", async () => {
    (env as any).PAYMONGO_WEBHOOK_SECRET = undefined;
    const body = webhookBody("txn-1");
    // Even a signature computed with a guessed/empty secret must not pass,
    // since verifyWebhookSignature() must return false outright when unset.
    const req = {
      body,
      headers: { "paymongo-signature": signBody(body, "whsec_test") },
    } as unknown as Request;
    const res = makeRes();
    const next = jest.fn();

    await confirmPayment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.transaction.findUnique).not.toHaveBeenCalled();
  });

  it("accepts a webhook with a correctly computed signature", async () => {
    (env as any).PAYMONGO_WEBHOOK_SECRET = "whsec_test";
    const body = webhookBody("txn-1");
    const req = {
      body,
      headers: { "paymongo-signature": signBody(body, "whsec_test") },
    } as unknown as Request;
    const res = makeRes();
    const next = jest.fn();

    prismaMock.transaction.findUnique.mockResolvedValue({
      id: "txn-1",
      status: "PENDING",
      type: "LATE_FEE",
      rentalId: "rental-1",
      amount: 500,
      rental: {
        ownerId: "owner-1",
        item: { title: "Calculator" },
        renter: { email: "a@b.com", firstName: "A" },
      },
    } as never);
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.transaction.update.mockResolvedValue({
      id: "txn-1",
      status: "COMPLETED",
    } as never);

    await confirmPayment(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
  });

  it("rejects a non-webhook-shaped confirm request in production (no manual-confirm bypass)", async () => {
    (env as any).NODE_ENV = "production";
    const req = {
      body: { transactionId: "txn-1", paymentId: "pi_1" },
      headers: {},
    } as unknown as Request;
    const res = makeRes();
    const next = jest.fn();

    await confirmPayment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.transaction.findUnique).not.toHaveBeenCalled();
  });
});

// Phase 2 fix under test: confirmPayment previously advanced a rental to
// AWAITING_DEPOSIT the moment *either* RENTAL_PAYMENT or SECURITY_DEPOSIT
// completed — a renter could pay just the refundable deposit, skip the
// actual rental fee, and the owner would still be told to hand over the item.
describe("confirmPayment — both RENTAL_PAYMENT and SECURITY_DEPOSIT required (Phase 2)", () => {
  function manualConfirmReq(transactionId: string): Request {
    return {
      body: { transactionId, paymentId: "pi_1" },
      headers: {},
    } as unknown as Request;
  }

  it("does not advance the rental when only SECURITY_DEPOSIT has completed (RENTAL_PAYMENT still pending)", async () => {
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: "txn-deposit",
      status: "PENDING",
      type: "SECURITY_DEPOSIT",
      userId: "renter-1",
      rentalId: "rental-1",
      amount: 500,
      rental: {
        ownerId: "owner-1",
        item: { title: "Calculator" },
        renter: { email: "a@b.com", firstName: "A" },
      },
    } as never);
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.transaction.update.mockResolvedValue({
      id: "txn-deposit",
      status: "COMPLETED",
    } as never);
    // The other required payment (RENTAL_PAYMENT) has NOT completed yet.
    prismaMock.transaction.findFirst.mockResolvedValue(null);

    const req = manualConfirmReq("txn-deposit");
    const res = makeRes();
    const next = jest.fn();

    await confirmPayment(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("advances the rental to AWAITING_DEPOSIT once both payments have completed", async () => {
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: "txn-rental",
      status: "PENDING",
      type: "RENTAL_PAYMENT",
      userId: "renter-1",
      rentalId: "rental-1",
      amount: 5000,
      rental: {
        ownerId: "owner-1",
        item: { title: "Calculator" },
        renter: { email: "a@b.com", firstName: "A" },
      },
    } as never);
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.transaction.update.mockResolvedValue({
      id: "txn-rental",
      status: "COMPLETED",
    } as never);
    // SECURITY_DEPOSIT already completed earlier.
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: "txn-deposit",
      status: "COMPLETED",
    } as never);
    prismaMock.rental.updateMany.mockResolvedValue({ count: 1 } as never);

    const req = manualConfirmReq("txn-rental");
    const res = makeRes();
    const next = jest.fn();

    await confirmPayment(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // 2026-10-11 (shared confirmation path): only a rental still PENDING
    // advances, so a late confirmation can never pull a rental back.
    expect(prismaMock.rental.updateMany).toHaveBeenCalledWith({
      where: { id: "rental-1", status: "PENDING" },
      data: { status: "AWAITING_DEPOSIT" },
    });
  });
});

// ---------------------------------------------------------------------------
// PAYMENTS RULING, 2026-09-06 — payments are a manual admin control.
//
// The renter pays the platform out of band (GCash/cash); an admin verifies
// receipt and approves in the console. PayMongo is dormant, not deleted, so
// the PAYMONGO branch must keep working — this is a route change, not a
// removal. What must NOT happen under MANUAL is a checkout URL: TEST keys are
// installed on the deployment, so without this gate `POST /payments` returns a
// real checkout.paymongo.com URL and the renter is sent to a card form for
// money that is supposed to move by hand.
// ---------------------------------------------------------------------------
// SUPERSEDED 2026-10-11 (Dispute v2, ruling 6, extended by the user to all
// payments): PayMongo is now PRIMARY and manual is the FALLBACK. MANUAL stays as
// a kill switch, and these tests now pin that kill switch: with it set, no
// checkout is created even though a key is installed.
describe("createPayment — PAYMENT_MODE=MANUAL kill switch (the manual fallback)", () => {
  const realMode = (env as any).PAYMENT_MODE;
  const realKey = env.PAYMONGO_SECRET_KEY;

  beforeEach(() => {
    mockReset(prismaMock);
    (axios.post as jest.Mock).mockReset();
    // The deployment really does have a live TEST key installed. Setting it
    // here is the point: MANUAL must win over a present key, otherwise this
    // test passes for the wrong reason on a machine with no key configured.
    (env as any).PAYMONGO_SECRET_KEY = "sk_test_pretend";
    (env as any).PAYMENT_MODE = "MANUAL";
    // P2: and a fully configured LIVE gateway. MANUAL must still win (SPEC section 6).
    (env as any).PAYMENT_GATEWAY = "live";
    (env as any).PAYMENT_GATEWAY_LIVE_URL = "https://pay-live.example";
    (env as any).PAYMENT_GATEWAY_LIVE_TOKEN = "l".repeat(40);
    (axios.get as jest.Mock).mockReset();
    (axios.request as jest.Mock).mockReset();
  });

  afterEach(() => {
    (env as any).PAYMENT_MODE = realMode;
    (env as any).PAYMONGO_SECRET_KEY = realKey;
    (env as any).PAYMENT_GATEWAY = undefined;
    (env as any).PAYMENT_GATEWAY_LIVE_URL = undefined;
    (env as any).PAYMENT_GATEWAY_LIVE_TOKEN = undefined;
  });

  function mockRental(over: Record<string, unknown> = {}) {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      renterId: "renter-1",
      totalPrice: 5000,
      securityDeposit: 500,
      item: { title: "Laptop" },
      ...over,
    } as never);
  }

  function mockNoExistingTransaction() {
    prismaMock.transaction.findFirst.mockResolvedValue(null as never);
  }

  function mockCreateEchoes() {
    prismaMock.transaction.create.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: "txn-1", ...data }) as never,
    );
  }

  it("never calls PayMongo, even with a secret key configured", async () => {
    mockRental();
    mockNoExistingTransaction();
    mockCreateEchoes();

    const res = makeRes();
    await createPayment(
      makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT" }),
      res,
      jest.fn(),
    );

    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.request).not.toHaveBeenCalled();
  });

  it("returns paymentUrl null and an awaiting-confirmation state, not a checkout URL", async () => {
    mockRental();
    mockNoExistingTransaction();
    mockCreateEchoes();

    const res = makeRes();
    await createPayment(
      makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT" }),
      res,
      jest.fn(),
    );

    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data.paymentUrl).toBeNull();
    expect(payload.data.paymentMode).toBe("MANUAL");
    expect(payload.data.status).toBe("AWAITING_CONFIRMATION");
    // The phone cannot render "send ₱5,000 to this number" unless the server
    // says the amount and the channel. D-23's fix depends on this block.
    expect(payload.data.instructions.amount).toBe(5000);
    expect(typeof payload.data.instructions.channel).toBe("string");
  });

  it("records the transaction as Manual, not as PayMongo, in the ledger", async () => {
    mockRental();
    mockNoExistingTransaction();
    mockCreateEchoes();

    await createPayment(
      makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT" }),
      makeRes(),
      jest.fn(),
    );

    const createCall = prismaMock.transaction.create.mock.calls[0][0] as any;
    expect(createCall.data.status).toBe("PENDING");
    expect(createCall.data.paymentMethod).not.toBe("PayMongo");
  });

  it("still derives the amount server-side under manual mode", async () => {
    mockRental();
    mockNoExistingTransaction();
    mockCreateEchoes();

    await createPayment(
      makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT", amount: 1 }),
      makeRes(),
      jest.fn(),
    );

    const createCall = prismaMock.transaction.create.mock.calls[0][0] as any;
    expect(createCall.data.amount).toBe(5000);
  });

  // Under the old flow a duplicate PENDING row was harmless — an abandoned
  // PayMongo checkout session. Under manual payments the admin console lists
  // every PENDING transaction and each carries its own approve button, so two
  // rows for one rental are two approvable charges.
  it("reuses an existing PENDING transaction instead of creating a second one", async () => {
    mockRental();
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: "txn-existing",
      rentalId: "rental-1",
      userId: "renter-1",
      type: "RENTAL_PAYMENT",
      amount: 5000,
      status: "PENDING",
    } as never);

    const res = makeRes();
    await createPayment(
      makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT" }),
      res,
      jest.fn(),
    );

    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data.transaction.id).toBe("txn-existing");
    expect(payload.data.status).toBe("AWAITING_CONFIRMATION");
  });

  it("refuses a second payment once one is already COMPLETED", async () => {
    mockRental();
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: "txn-paid",
      status: "COMPLETED",
      type: "RENTAL_PAYMENT",
      amount: 5000,
    } as never);

    const next = jest.fn();
    await createPayment(
      makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT" }),
      makeRes(),
      next,
    );

    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 }),
    );
  });
});

// P2 (SPEC-PAYMENT-GATEWAY.md §3): the checkout comes from the payment
// gateway, never from PayMongo directly. Each guard below was removed once and
// one of these tests failed (PROGRESS.md P2 mutation log).
describe("createPayment — through the payment gateway (P2)", () => {
  const G = ["PAYMENT_MODE", "PAYMENT_GATEWAY", "PAYMENT_GATEWAY_SANDBOX_URL", "PAYMENT_GATEWAY_SANDBOX_TOKEN", "PAYMENT_GATEWAY_LIVE_URL", "PAYMENT_GATEWAY_LIVE_TOKEN", "PAYMONGO_SECRET_KEY"];
  const saved: Record<string, unknown> = {};
  const healthOk = (mode: string, keyMode: string) => (axios.get as jest.Mock).mockResolvedValue({ data: { mode, keyMode } });
  const checkoutOk = () =>
    (axios.request as jest.Mock).mockResolvedValue({ data: { checkoutId: "cs_1", checkoutUrl: "https://checkout.paymongo.com/cs_1" } });

  beforeEach(() => {
    for (const k of G) saved[k] = (env as any)[k];
    mockReset(prismaMock);
    (axios.post as jest.Mock).mockReset();
    (axios.get as jest.Mock).mockReset();
    (axios.request as jest.Mock).mockReset();
    (env as any).PAYMENT_MODE = "PAYMONGO";
    (env as any).PAYMENT_GATEWAY = "sandbox";
    (env as any).PAYMENT_GATEWAY_SANDBOX_URL = "https://pay-sandbox.example";
    (env as any).PAYMENT_GATEWAY_SANDBOX_TOKEN = "s".repeat(40);
    (env as any).PAYMENT_GATEWAY_LIVE_URL = "https://pay-live.example";
    (env as any).PAYMENT_GATEWAY_LIVE_TOKEN = "l".repeat(40);
    (env as any).PAYMONGO_SECRET_KEY = undefined; // the key is on Render now
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      renterId: "renter-1",
      totalPrice: 5000,
      securityDeposit: 500,
      item: { title: "Laptop" },
    } as never);
    prismaMock.transaction.findFirst.mockResolvedValue(null as never);
    prismaMock.transaction.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "txn-1", ...data }) as never);
    prismaMock.transaction.update.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: "txn-1", rentalId: "rental-1", ...data }) as never,
    );
  });
  afterEach(() => {
    for (const k of G) (env as any)[k] = saved[k];
  });

  async function pay() {
    const res = makeRes();
    await createPayment(makeReq({ rentalId: "rental-1", type: "RENTAL_PAYMENT" }), res, jest.fn());
    return { res, payload: (res.json as jest.Mock).mock.calls[0]?.[0] };
  }

  it("creates the checkout on the sandbox gateway, records paymentEnv, and says TEST mode", async () => {
    healthOk("sandbox", "test");
    checkoutOk();
    const { payload } = await pay();
    expect(payload.data.paymentMode).toBe("PAYMONGO");
    expect(payload.data.paymentUrl).toBe("https://checkout.paymongo.com/cs_1");
    expect(payload.data.testMode).toBe(true);
    const req = (axios.request as jest.Mock).mock.calls[0][0];
    expect(req.url).toBe("https://pay-sandbox.example/checkouts");
    expect(req.data.amount).toBe(5000); // pesos, from the rental, never the client
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymongoCheckoutId: "cs_1", paymentEnv: "sandbox" }) }),
    );
    expect(axios.post).not.toHaveBeenCalled(); // nothing goes to api.paymongo.com
  });

  it("on the live gateway: paymentEnv live, no TEST mode", async () => {
    (env as any).PAYMENT_GATEWAY = "live";
    healthOk("live", "live");
    checkoutOk();
    const { payload } = await pay();
    expect(payload.data.testMode).toBe(false);
    expect((axios.request as jest.Mock).mock.calls[0][0].url).toBe("https://pay-live.example/checkouts");
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentEnv: "live" }) }),
    );
  });

  it("a sleeping gateway: 503 with the 'Connecting…' copy, and NO transaction recorded", async () => {
    _resetWaking();
    (axios.get as jest.Mock).mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    const { res, payload } = await pay();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(payload.code).toBe("PAYMENT_SERVICE_WAKING");
    expect(payload.message).toMatch(/^Connecting to the payment service/);
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    expect(axios.request).not.toHaveBeenCalled();
  });

  it("asleep for 90 s or more: the manual GCash fallback (user 2026-10-21), and a wake resets the clock", async () => {
    _resetWaking();
    const t0 = 1_800_000_000_000;
    const now = jest.spyOn(Date, "now");
    (axios.get as jest.Mock).mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    now.mockReturnValue(t0);
    expect((await pay()).res.status).toHaveBeenCalledWith(503); // first seen asleep: Connecting…
    now.mockReturnValue(t0 + 89_000);
    expect((await pay()).res.status).toHaveBeenCalledWith(503); // still under 90 s
    now.mockReturnValue(t0 + 91_000);
    const late = await pay();
    expect(late.payload.data.paymentMode).toBe("MANUAL");
    expect(late.payload.data.instructions.amount).toBe(5000);
    expect(axios.request).not.toHaveBeenCalled();
    // it wakes: the clock resets, so the next nap starts at "Connecting…" again
    (axios.get as jest.Mock).mockResolvedValueOnce({ data: { mode: "sandbox", keyMode: "test" } });
    (axios.request as jest.Mock).mockRejectedValueOnce({ response: { status: 502 } });
    prismaMock.transaction.findFirst.mockResolvedValue(null as never);
    await pay();
    now.mockReturnValue(t0 + 200_000);
    expect((await pay()).res.status).toHaveBeenCalledWith(503);
    now.mockRestore();
    _resetWaking();
  });

  it("a gateway reporting the wrong mode: fails closed (no checkout), manual fallback", async () => {
    healthOk("live", "live"); // PAYMENT_GATEWAY=sandbox, but the URL is the live gateway
    checkoutOk();
    const { payload } = await pay();
    expect(axios.request).not.toHaveBeenCalled();
    expect(payload.data.paymentMode).toBe("MANUAL");
    expect(payload.data.paymentUrl).toBeNull();
    expect(prismaMock.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentMethod: "Manual" }) }),
    );
  });

  it("the gateway fails creating the checkout: manual fallback (never a mock URL)", async () => {
    healthOk("sandbox", "test");
    (axios.request as jest.Mock).mockRejectedValue({ response: { status: 502 } });
    const { payload } = await pay();
    expect(payload.data.paymentMode).toBe("MANUAL");
    expect(payload.data.paymentUrl).toBeNull();
    expect(payload.data.instructions.amount).toBe(5000);
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(expect.objectContaining({ data: { paymentMethod: "Manual" } }));
  });

  it("a reused sandbox checkout stays TEST mode after a switch to live", async () => {
    (env as any).PAYMENT_GATEWAY = "live";
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: "txn-1",
      status: "PENDING",
      paymentMethod: "PayMongo",
      paymongoCheckoutId: "cs_old",
      paymentEnv: "sandbox",
      paymentDetails: { checkoutUrl: "https://checkout.paymongo.com/cs_old" },
    } as never);
    const { payload } = await pay();
    expect(payload.data.paymentUrl).toBe("https://checkout.paymongo.com/cs_old");
    expect(payload.data.testMode).toBe(true);
    expect(axios.get).not.toHaveBeenCalled(); // no new checkout, so no health check needed
  });
});

describe("createRefund / refundPayment — through the payment's OWN gateway (P2.4)", () => {
  const G = ["PAYMENT_MODE", "PAYMENT_GATEWAY", "PAYMENT_GATEWAY_SANDBOX_URL", "PAYMENT_GATEWAY_SANDBOX_TOKEN", "PAYMENT_GATEWAY_LIVE_URL", "PAYMENT_GATEWAY_LIVE_TOKEN", "PAYMONGO_SECRET_KEY"];
  const saved: Record<string, unknown> = {};
  beforeEach(() => {
    for (const k of G) saved[k] = (env as any)[k];
    mockReset(prismaMock);
    (axios.request as jest.Mock).mockReset();
    (env as any).PAYMENT_MODE = "PAYMONGO";
    (env as any).PAYMENT_GATEWAY = "live";
    (env as any).PAYMENT_GATEWAY_SANDBOX_URL = "https://pay-sandbox.example";
    (env as any).PAYMENT_GATEWAY_SANDBOX_TOKEN = "s".repeat(40);
    (env as any).PAYMENT_GATEWAY_LIVE_URL = "https://pay-live.example";
    (env as any).PAYMENT_GATEWAY_LIVE_TOKEN = "l".repeat(40);
    (env as any).PAYMONGO_SECRET_KEY = undefined;
  });
  afterEach(() => {
    for (const k of G) (env as any)[k] = saved[k];
  });

  it("a sandbox payment is refunded on the sandbox gateway while live is active", async () => {
    (axios.request as jest.Mock).mockResolvedValue({ data: { refundId: "ref_1", status: "pending" } });
    await expect(
      createRefund({ paymentId: "pay_1", amount: 150, reason: "others", from: { paymentEnv: "sandbox", paymongoPaymentId: "pay_1" } }),
    ).resolves.toBe("ref_1");
    const req = (axios.request as jest.Mock).mock.calls[0][0];
    expect(req.url).toBe("https://pay-sandbox.example/refunds");
    expect(req.data).toEqual({ paymentId: "pay_1", amount: 150, reason: "others" });
  });

  it("refuses (throws) when that payment's gateway is not configured here, and sends nothing", async () => {
    (env as any).PAYMENT_GATEWAY_LIVE_URL = "";
    await expect(
      createRefund({ paymentId: "pay_1", amount: 150, reason: "others", from: { paymentEnv: "live", paymongoPaymentId: "pay_1" } }),
    ).rejects.toThrow(/not configured/);
    expect(axios.request).not.toHaveBeenCalled();
  });

  it("refuses a payment with no recognisable gateway (an unknown paymentEnv is never guessed)", async () => {
    await expect(
      createRefund({ paymentId: "pay_1", amount: 150, reason: "others", from: { paymentEnv: "prod", paymongoPaymentId: "pay_1" } }),
    ).rejects.toThrow(/no payment gateway is recorded/);
    expect(axios.request).not.toHaveBeenCalled();
  });

  it("still refunds under the MANUAL kill switch (it stops new payments, not refunds)", async () => {
    (env as any).PAYMENT_MODE = "MANUAL";
    (axios.request as jest.Mock).mockResolvedValue({ data: { refundId: "ref_2", status: "pending" } });
    await expect(
      createRefund({ paymentId: "pay_1", amount: 150, reason: "others", from: { paymentEnv: "live", paymongoPaymentId: "pay_1" } }),
    ).resolves.toBe("ref_2");
  });

  it("admin refund of a PayMongo payment whose gateway is missing: error, and the payment is NOT marked refunded", async () => {
    (env as any).PAYMENT_GATEWAY_LIVE_URL = "";
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: "tx-1", status: "COMPLETED", amount: 150, paymongoPaymentId: "pay_1", paymentEnv: "live", rentalId: "r-1", userId: "u-1",
      rental: { item: { title: "Laptop" } },
    } as never);
    const next = jest.fn();
    const req = { params: { transactionId: "tx-1" }, user: { userId: "admin-1", role: "ADMIN" } } as unknown as AuthRequest;
    await refundPayment(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/refund failed/i) }));
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });
});
