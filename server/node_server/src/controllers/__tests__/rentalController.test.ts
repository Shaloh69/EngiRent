import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

// Phase 0 fix under test (M11): updateRentalStatus previously let any
// participant set a rental to ANY status directly — including states that
// are supposed to be earned through kiosk verification/payment (DEPOSITED,
// ACTIVE, COMPLETED, etc.), bypassing those gates entirely. It must now only
// allow the whitelisted manual transitions (PENDING/AWAITING_DEPOSIT → CANCELLED).

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { updateRentalStatus } from "../rentalController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(id: string, status: string): AuthRequest {
  return {
    params: { id },
    body: { status },
    user: { userId: "renter-1", email: "a@b.com", studentId: "s1", role: "STUDENT" },
  } as unknown as AuthRequest;
}

describe("updateRentalStatus — manual transition whitelist (Phase 0 / M11)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("allows PENDING -> CANCELLED (whitelisted)", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      status: "PENDING",
      renterId: "renter-1",
      ownerId: "owner-1",
      itemId: "item-1",
      item: { title: "Calculator" },
    } as never);
    prismaMock.rental.update.mockResolvedValue({ id: "rental-1", status: "CANCELLED" } as never);

    const req = makeReq("rental-1", "CANCELLED");
    const res = makeRes();
    const next = jest.fn();

    await updateRentalStatus(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.rental.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } }),
    );
  });

  it("rejects a participant trying to jump straight to DEPOSITED (bypassing kiosk verification)", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      status: "AWAITING_DEPOSIT",
      renterId: "renter-1",
      ownerId: "owner-1",
      itemId: "item-1",
      item: { title: "Calculator" },
    } as never);

    const req = makeReq("rental-1", "DEPOSITED");
    const res = makeRes();
    const next = jest.fn();

    await updateRentalStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("rejects a participant trying to force COMPLETED directly", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      status: "ACTIVE",
      renterId: "renter-1",
      ownerId: "owner-1",
      itemId: "item-1",
      item: { title: "Calculator" },
    } as never);

    const req = makeReq("rental-1", "COMPLETED");
    const res = makeRes();
    const next = jest.fn();

    await updateRentalStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("rejects CANCELLED from a status not in the whitelist (e.g. DISPUTED)", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      status: "DISPUTED",
      renterId: "renter-1",
      ownerId: "owner-1",
      itemId: "item-1",
      item: { title: "Calculator" },
    } as never);

    const req = makeReq("rental-1", "CANCELLED");
    const res = makeRes();
    const next = jest.fn();

    await updateRentalStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });
});
