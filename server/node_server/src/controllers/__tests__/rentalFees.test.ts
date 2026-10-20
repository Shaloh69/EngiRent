import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

// Renter fees F2 (2026-10-21): a booking stores its fees; the rental payment
// charges rent + fees (₱112 for the user's example); the deposit has none; an
// older rental (fees 0) is charged exactly as before; an extension adds the
// platform fee on the extra rent at the rental's own booked rate. Each rule
// was removed once and a test here failed (PROGRESS.md, PHASE RENTER FEES).

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("../../services/paymentGateway", () => ({ ...jest.requireActual("../../services/paymentGateway"), wake: jest.fn() }));
jest.mock("../../services/adminRoom", () => ({ notifyAdmins: jest.fn() }));
jest.mock("../../services/itemAvailabilityService", () => ({
  findOverlappingRentals: jest.fn().mockResolvedValue([]),
  recomputeItemAvailability: jest.fn(),
}));

import prisma from "../../config/database";
import env from "../../config/env";
import { createRental, extendRental } from "../rentalController";
import { createPayment } from "../paymentController";
import { AuthRequest } from "../../middleware/auth";

const db = prisma as unknown as DeepMockProxy<PrismaClient>;
const E = env as any;
let savedMode: unknown;
const res = () => {
  const r: Partial<Response> = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r as Response;
};
const as = (userId: string, extra: Record<string, unknown>) =>
  ({ user: { userId, email: "a@b.com", studentId: "s1", role: "STUDENT", isVerified: true }, ...extra }) as unknown as AuthRequest;
const day = 86_400_000;

beforeEach(() => {
  mockReset(db);
  savedMode = E.PAYMENT_MODE;
  E.PAYMENT_MODE = "MANUAL"; // these pin AMOUNTS; no gateway involved
  db.$transaction.mockImplementation((async (fn: any) => (typeof fn === "function" ? fn(db) : fn)) as never);
});
afterEach(() => {
  E.PAYMENT_MODE = savedMode;
});

describe("booking stores the fees from the current settings", () => {
  async function book(days: number, fees: { platformFeePct: number; serviceFee: number } | null) {
    db.feeConfig.findUnique.mockResolvedValue((fees ? { id: 1, ...fees } : null) as never);
    db.item.findUnique.mockResolvedValue({ id: "i1", ownerId: "owner-1", isListed: true, isActive: true, pricePerDay: 100, securityDeposit: 50, title: "Glue Gun", owner: { id: "owner-1" } } as never);
    db.rental.create.mockResolvedValue({ id: "r1", status: "PENDING" } as never);
    const start = new Date(Date.now() + day);
    const end = new Date(start.getTime() + days * day);
    const next = jest.fn();
    await createRental(as("renter-1", { body: { itemId: "i1", startDate: start.toISOString(), endDate: end.toISOString() } }), res(), next);
    expect(next).not.toHaveBeenCalled();
    return (db.rental.create.mock.calls[0][0] as any).data;
  }

  it("1 day at ₱100, defaults: rent 100 (totalPrice), platform 2, service 10", async () => {
    const d = await book(1, null);
    expect(d).toMatchObject({ totalPrice: 100, platformFee: 2, serviceFee: 10, securityDeposit: 50 });
  });
  it("3 days: rent 300, platform 6, service 10 once", async () => {
    const d = await book(3, null);
    expect(d).toMatchObject({ totalPrice: 300, platformFee: 6, serviceFee: 10 });
  });
  it("uses the admin's saved settings", async () => {
    const d = await book(1, { platformFeePct: 5, serviceFee: 15 });
    expect(d).toMatchObject({ totalPrice: 100, platformFee: 5, serviceFee: 15 });
  });
});

describe("what the renter is charged", () => {
  async function charge(type: string, rental: Record<string, unknown>) {
    db.rental.findUnique.mockResolvedValue({ id: "r1", renterId: "renter-1", item: { title: "Glue Gun" }, securityDeposit: 50, ...rental } as never);
    db.transaction.findFirst.mockResolvedValue(null as never);
    db.transaction.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "t1", ...data }) as never);
    const r = res();
    const next = jest.fn();
    await createPayment(as("renter-1", { body: { rentalId: "r1", type } }), r, next);
    expect(next).not.toHaveBeenCalled();
    return (r.json as jest.Mock).mock.calls[0][0].data.instructions.amount;
  }

  it("rental payment = rent + platform fee + service fee = ₱112", async () => {
    await expect(charge("RENTAL_PAYMENT", { totalPrice: 100, platformFee: 2, serviceFee: 10 })).resolves.toBe(112);
  });
  it("the deposit carries no fees", async () => {
    await expect(charge("SECURITY_DEPOSIT", { totalPrice: 100, platformFee: 2, serviceFee: 10 })).resolves.toBe(50);
  });
  it("a rental booked before the fees (0 / 0) is charged the rent only, as before", async () => {
    await expect(charge("RENTAL_PAYMENT", { totalPrice: 100, platformFee: 0, serviceFee: 0 })).resolves.toBe(100);
  });
});

describe("extending a rental", () => {
  async function extend(rental: Record<string, unknown>, extraDays: number) {
    const start = new Date(Date.now() - day);
    const end = new Date(start.getTime() + 1 * day);
    db.rental.findUnique.mockResolvedValue({
      id: "r1", renterId: "renter-1", ownerId: "owner-1", itemId: "i1", status: "ACTIVE",
      startDate: start, endDate: end, item: { pricePerDay: 100, title: "Glue Gun" }, ...rental,
    } as never);
    const next = jest.fn();
    await extendRental(as("renter-1", { params: { id: "r1" }, body: { endDate: new Date(end.getTime() + extraDays * day).toISOString() } }), res(), next);
    expect(next).not.toHaveBeenCalled();
    return {
      update: (db.rental.update.mock.calls[0][0] as any).data,
      fee: db.transaction.create.mock.calls.map((c) => (c[0] as any).data).find((d: any) => d.type === "EXTENSION_FEE"),
    };
  }

  it("2 more days at 2%: the extra rent ₱200 + ₱4 platform fee, no second ₱10", async () => {
    const { update, fee } = await extend({ totalPrice: 100, platformFee: 2, serviceFee: 10 }, 2);
    expect(update).toMatchObject({ totalPrice: 300, platformFee: 6 });
    expect(update.serviceFee).toBeUndefined();
    expect(fee.amount).toBe(204);
  });
  it("uses the rate the rental was BOOKED at, not today's setting", async () => {
    db.feeConfig.findUnique.mockResolvedValue({ id: 1, platformFeePct: 10, serviceFee: 10 } as never);
    const { fee } = await extend({ totalPrice: 100, platformFee: 2, serviceFee: 10 }, 2);
    expect(fee.amount).toBe(204);
  });
  it("a rental booked before the fees: the extra rent only, as before", async () => {
    const { update, fee } = await extend({ totalPrice: 100, platformFee: 0, serviceFee: 0 }, 2);
    expect(update.platformFee).toBe(0);
    expect(fee.amount).toBe(200);
  });
});
