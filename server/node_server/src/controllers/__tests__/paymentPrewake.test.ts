import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * P2.7 (SPEC-PAYMENT-GATEWAY.md §4): wake the payment gateway when a payment
 * is coming, so a free Render service that slept is awake by the time the
 * student taps Pay. Repo-derived triggers (there is no owner-approval step: a
 * booking is created PENDING and paid at once): a booking is created; the
 * renter opens an unpaid (PENDING) booking. The kiosk-visit trigger is tested in
 * paymentGatewayFlows.test.ts. Each trigger was removed once and a test failed.
 */

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("../../services/paymentGateway", () => ({ wake: jest.fn() }));
jest.mock("../../services/adminRoom", () => ({ notifyAdmins: jest.fn() }));
jest.mock("../../services/itemAvailabilityService", () => ({
  findOverlappingRentals: jest.fn().mockResolvedValue([]),
  recomputeItemAvailability: jest.fn(),
}));

import prisma from "../../config/database";
import { wake } from "../../services/paymentGateway";
import { createRental, getRentalById } from "../rentalController";
import { AuthRequest } from "../../middleware/auth";

const db = prisma as unknown as DeepMockProxy<PrismaClient>;
const wakeMock = wake as jest.Mock;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}
const as = (userId: string, extra: Record<string, unknown> = {}) =>
  ({ user: { userId, email: "a@b.com", studentId: "s1", role: "STUDENT" }, ...extra }) as unknown as AuthRequest;

beforeEach(() => {
  mockReset(db);
  wakeMock.mockReset();
});

describe("getRentalById pre-wake", () => {
  const rental = (status: string) => ({ id: "r1", status, renterId: "renter-1", ownerId: "owner-1" });

  it("the renter opening an unpaid booking wakes the gateway", async () => {
    db.rental.findUnique.mockResolvedValue(rental("PENDING") as never);
    await getRentalById(as("renter-1", { params: { id: "r1" } }), makeRes(), jest.fn());
    expect(wakeMock).toHaveBeenCalledTimes(1);
  });
  it("the owner opening it does not (they don't pay)", async () => {
    db.rental.findUnique.mockResolvedValue(rental("PENDING") as never);
    await getRentalById(as("owner-1", { params: { id: "r1" } }), makeRes(), jest.fn());
    expect(wakeMock).not.toHaveBeenCalled();
  });
  it("an already paid booking does not", async () => {
    db.rental.findUnique.mockResolvedValue(rental("AWAITING_DEPOSIT") as never);
    await getRentalById(as("renter-1", { params: { id: "r1" } }), makeRes(), jest.fn());
    expect(wakeMock).not.toHaveBeenCalled();
  });
});

describe("createRental pre-wake", () => {
  it("a new booking wakes the gateway", async () => {
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(Date.now() + 3 * 86_400_000);
    db.item.findUnique.mockResolvedValue({ id: "i1", ownerId: "owner-1", isListed: true, isActive: true, pricePerDay: 30, securityDeposit: 100, title: "Calculator", owner: { id: "owner-1" } } as never);
    db.rental.create.mockResolvedValue({ id: "r1", status: "PENDING" } as never);
    const res = makeRes();
    const next = jest.fn();
    await createRental(as("renter-1", { body: { itemId: "i1", startDate: start.toISOString(), endDate: end.toISOString() } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(wakeMock).toHaveBeenCalledTimes(1);
  });
});
