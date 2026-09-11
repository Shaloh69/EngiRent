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
import { listAllLockers, releaseLocker } from "../kioskController";
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


describe("listAllLockers — D-63: the admin must be able to SEE locker state", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("does NOT filter by status or isOperational", async () => {
    // The whole point. getAvailableLockers hard-filters
    // `status: AVAILABLE, isOperational: true`, which is why no client could
    // ever see an OCCUPIED or out-of-service bay. If this endpoint ever grows
    // the same filter it stops answering the question it exists for, and the
    // admin goes back to releasing lockers blind.
    prismaMock.locker.findMany.mockResolvedValue([] as never);

    const req = { query: {}, user: { role: "ADMIN" } } as unknown as AuthRequest;
    await listAllLockers(req, makeRes(), jest.fn());

    const arg = prismaMock.locker.findMany.mock.calls[0][0] as Record<string, unknown>;
    // Scoped to `where` deliberately. An earlier version of this assertion
    // searched the WHOLE argument for "isOperational" and failed -- because
    // the field is legitimately in `select`, which is the point: return it,
    // never filter on it.
    expect(arg.where).toEqual({});
    expect(JSON.stringify(arg.where)).not.toContain("isOperational");
    expect(JSON.stringify(arg.where)).not.toContain("status");
  });

  it("returns the fields an operator needs to judge a stuck locker", async () => {
    prismaMock.locker.findMany.mockResolvedValue([] as never);
    const req = { query: {}, user: { role: "ADMIN" } } as unknown as AuthRequest;
    await listAllLockers(req, makeRes(), jest.fn());

    const arg = prismaMock.locker.findMany.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };
    // status alone is not enough: "OCCUPIED with no rental attached" IS the
    // stuck case the release action exists for.
    expect(arg.select.status).toBe(true);
    expect(arg.select.currentRentalId).toBe(true);
    expect(arg.select.isOperational).toBe(true);
    expect(arg.select.lockerNumber).toBe(true);
  });

  it("scopes to one kiosk when asked", async () => {
    prismaMock.locker.findMany.mockResolvedValue([] as never);
    const req = { query: { kioskId: "KIOSK-001" }, user: { role: "ADMIN" } } as unknown as AuthRequest;
    await listAllLockers(req, makeRes(), jest.fn());
    const arg = prismaMock.locker.findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.where).toEqual({ kioskId: "KIOSK-001" });
  });
});
