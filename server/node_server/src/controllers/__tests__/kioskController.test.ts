import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

// Phase 0 fix under test: releaseLocker's route comment claimed "admin or
// kiosk service" but had no actual check — any authenticated student could
// force-release any locker for any rental. It must now require ADMIN role,
// or that the caller is the renter/owner of the rental currently occupying
// the locker.

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { releaseLocker } from "../kioskController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(lockerId: string, userId: string, role: "STUDENT" | "ADMIN" = "STUDENT"): AuthRequest {
  return {
    params: { id: lockerId },
    user: { userId, email: "a@b.com", studentId: "s1", role },
  } as unknown as AuthRequest;
}

describe("releaseLocker — ownership/admin check (Phase 0)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("rejects a student who has no relation to the rental occupying the locker", async () => {
    prismaMock.locker.findUnique.mockResolvedValue({
      id: "locker-1",
      lockerNumber: "1",
      isOperational: true,
      currentRentalId: "rental-1",
    } as never);
    prismaMock.rental.findUnique.mockResolvedValue({
      renterId: "renter-1",
      ownerId: "owner-1",
    } as never);

    const req = makeReq("locker-1", "some-random-student");
    const res = makeRes();
    const next = jest.fn();

    await releaseLocker(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.locker.update).not.toHaveBeenCalled();
  });

  it("rejects a student trying to release a locker with no current rental", async () => {
    prismaMock.locker.findUnique.mockResolvedValue({
      id: "locker-1",
      lockerNumber: "1",
      isOperational: true,
      currentRentalId: null,
    } as never);

    const req = makeReq("locker-1", "some-random-student");
    const res = makeRes();
    const next = jest.fn();

    await releaseLocker(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.locker.update).not.toHaveBeenCalled();
  });

  it("allows the renter of the occupying rental to release their own locker", async () => {
    prismaMock.locker.findUnique.mockResolvedValue({
      id: "locker-1",
      lockerNumber: "1",
      isOperational: true,
      currentRentalId: "rental-1",
    } as never);
    prismaMock.rental.findUnique.mockResolvedValue({
      renterId: "renter-1",
      ownerId: "owner-1",
    } as never);
    prismaMock.locker.update.mockResolvedValue({} as never);

    const req = makeReq("locker-1", "renter-1");
    const res = makeRes();
    const next = jest.fn();

    await releaseLocker(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.locker.update).toHaveBeenCalled();
  });

  it("allows an admin to release any locker regardless of the occupying rental", async () => {
    prismaMock.locker.findUnique.mockResolvedValue({
      id: "locker-1",
      lockerNumber: "1",
      isOperational: true,
      currentRentalId: "rental-1",
    } as never);
    prismaMock.locker.update.mockResolvedValue({} as never);

    const req = makeReq("locker-1", "admin-1", "ADMIN");
    const res = makeRes();
    const next = jest.fn();

    await releaseLocker(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // Admin bypasses the rental lookup entirely.
    expect(prismaMock.rental.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.locker.update).toHaveBeenCalled();
  });
});
