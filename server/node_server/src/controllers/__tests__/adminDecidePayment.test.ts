import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

// PAYMENTS RULING, 2026-09-06 — item 3.
//
// Under manual payments the admin's approval IS the payment confirmation.
// Before this change `adminDecidePayment` wrote a Notification row and emitted
// nothing, so the renter's phone learned about its own payment only if the
// user happened to pull-to-refresh. Same class as D-1's missing ID-approval
// event: an admin action that reaches the database and stops there.

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("axios");

import prisma from "../../config/database";
import { adminDecidePayment } from "../adminController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeIo() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { io: { to }, to, emit };
}

function makeReq(
  transactionId: string,
  decision: "APPROVE" | "REJECT",
  io: unknown,
): AuthRequest {
  return {
    params: { transactionId },
    body: { decision },
    user: {
      userId: "admin-1",
      email: "admin@engirent.edu.ph",
      studentId: "a1",
      role: "ADMIN",
    },
    app: { get: (k: string) => (k === "io" ? io : undefined) },
  } as unknown as AuthRequest;
}

/** A PENDING RENTAL_PAYMENT on a rental owned by owner-1, rented by renter-1. */
function mockTransaction(over: Record<string, unknown> = {}) {
  prismaMock.transaction.findUnique.mockResolvedValue({
    id: "txn-1",
    rentalId: "rental-1",
    userId: "renter-1",
    type: "RENTAL_PAYMENT",
    amount: 5000,
    status: "PENDING",
    rental: {
      id: "rental-1",
      ownerId: "owner-1",
      renterId: "renter-1",
      item: { title: "Laptop" },
      renter: { email: "r@b.com", firstName: "Rene" },
    },
    ...over,
  } as never);
}

function emitsFor(to: jest.Mock, emit: jest.Mock) {
  // `to` and `emit` are separate mocks, so pair them up by call index to get
  // (room, event, payload) triples — asserting on `emit` alone would pass even
  // if every event went to the wrong room.
  return to.mock.calls.map((call, i) => ({
    room: call[0] as string,
    event: emit.mock.calls[i]?.[0] as string,
    payload: emit.mock.calls[i]?.[1] as Record<string, unknown>,
  }));
}

describe("adminDecidePayment — the decision must reach the phone", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.transaction.update.mockImplementation(
      ({ where, data }: any) =>
        Promise.resolve({ id: where.id, ...data }) as never,
    );
    prismaMock.notification.create.mockResolvedValue({} as never);
    prismaMock.rental.update.mockResolvedValue({} as never);
  });

  it("emits payment:approved to the renter when a payment is approved", async () => {
    mockTransaction();
    prismaMock.transaction.findFirst.mockResolvedValue(null as never);
    const { io, to, emit } = makeIo();

    await adminDecidePayment(
      makeReq("txn-1", "APPROVE", io),
      makeRes(),
      jest.fn(),
    );

    const events = emitsFor(to, emit);
    const renterEvent = events.find((e) => e.room === "user:renter-1");
    expect(renterEvent).toBeDefined();
    expect(renterEvent!.event).toBe("payment:approved");
    expect(renterEvent!.payload).toMatchObject({
      transactionId: "txn-1",
      rentalId: "rental-1",
      type: "RENTAL_PAYMENT",
      status: "COMPLETED",
    });
  });

  it("tells the renter whether anything is still outstanding", async () => {
    mockTransaction();
    // No matching SECURITY_DEPOSIT — the rental is not fully paid yet.
    prismaMock.transaction.findFirst.mockResolvedValue(null as never);
    const { io, to, emit } = makeIo();

    await adminDecidePayment(
      makeReq("txn-1", "APPROVE", io),
      makeRes(),
      jest.fn(),
    );

    const renterEvent = emitsFor(to, emit).find(
      (e) => e.room === "user:renter-1",
    );
    expect(renterEvent!.payload.fullyPaid).toBe(false);
    expect(renterEvent!.payload.remainingType).toBe("SECURITY_DEPOSIT");
  });

  it("notifies BOTH parties once the rental is fully paid — the owner has to act next", async () => {
    mockTransaction();
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: "txn-deposit",
      type: "SECURITY_DEPOSIT",
      status: "COMPLETED",
    } as never);
    const { io, to, emit } = makeIo();

    await adminDecidePayment(
      makeReq("txn-1", "APPROVE", io),
      makeRes(),
      jest.fn(),
    );

    const events = emitsFor(to, emit);
    const rooms = events.map((e) => e.room);
    expect(rooms).toContain("user:renter-1");
    expect(rooms).toContain("user:owner-1");
    const ownerEvent = events.find((e) => e.room === "user:owner-1")!;
    expect(ownerEvent.event).toBe("payment:approved");
    // The owner's next action is depositing the item, so the phone needs the
    // rental's new status, not just "a payment happened".
    expect(ownerEvent.payload.rentalStatus).toBe("AWAITING_DEPOSIT");
    expect(
      events.find((e) => e.room === "user:renter-1")!.payload.fullyPaid,
    ).toBe(true);
  });

  it("emits payment:rejected to the renter when a payment is rejected", async () => {
    mockTransaction();
    const { io, to, emit } = makeIo();

    await adminDecidePayment(
      makeReq("txn-1", "REJECT", io),
      makeRes(),
      jest.fn(),
    );

    const events = emitsFor(to, emit);
    expect(events).toHaveLength(1);
    expect(events[0].room).toBe("user:renter-1");
    expect(events[0].event).toBe("payment:rejected");
    expect(events[0].payload).toMatchObject({
      transactionId: "txn-1",
      status: "FAILED",
    });
  });

  // The endpoint is idempotent by design (it claims PENDING → PROCESSING
  // through updateMany so a double-click cannot double-complete). The event
  // must inherit that: a second approval of an already-settled transaction
  // must not tell the renter their payment was approved twice.
  it("does not re-emit when the transaction is already COMPLETED", async () => {
    mockTransaction({ status: "COMPLETED" });
    const { io, emit } = makeIo();

    await adminDecidePayment(
      makeReq("txn-1", "APPROVE", io),
      makeRes(),
      jest.fn(),
    );

    expect(emit).not.toHaveBeenCalled();
  });

  it("does not re-emit when another request already claimed the transaction", async () => {
    mockTransaction();
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 0 } as never);
    const { io, emit } = makeIo();

    await adminDecidePayment(
      makeReq("txn-1", "APPROVE", io),
      makeRes(),
      jest.fn(),
    );

    expect(emit).not.toHaveBeenCalled();
  });

  // io is fetched from the express app, and adminController's kiosk-config
  // handler already guards for its absence. A missing socket server must not
  // turn a successful payment approval into a 500.
  it("still approves the payment when no socket server is attached", async () => {
    mockTransaction();
    prismaMock.transaction.findFirst.mockResolvedValue(null as never);
    const res = makeRes();
    const next = jest.fn();

    await adminDecidePayment(makeReq("txn-1", "APPROVE", undefined), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });
});
