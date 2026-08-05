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
import { createPayment, confirmPayment } from "../paymentController";
import { AuthRequest } from "../../middleware/auth";
import env from "../../config/env";
import crypto from "crypto";

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
  beforeEach(() => {
    mockReset(prismaMock);
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
    prismaMock.rental.update.mockResolvedValue({} as never);

    const req = manualConfirmReq("txn-rental");
    const res = makeRes();
    const next = jest.fn();

    await confirmPayment(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.rental.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "AWAITING_DEPOSIT" } }),
    );
  });
});
