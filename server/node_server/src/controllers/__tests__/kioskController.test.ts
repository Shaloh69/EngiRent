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
import { listAllLockers, releaseLocker, setLockerService } from "../kioskController";
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
    // E5: releasing a locker now goes through `clearBay`, which does its
    // read-modify-write inside `prisma.$transaction(async (tx) => ...)` so the
    // two compartments can never be written from a stale sibling. A bare
    // `mockDeep` stubs `$transaction` to resolve WITHOUT calling the callback,
    // which made these tests pass vacuously in principle and fail in fact: the
    // write never ran. Handing the mock client in as `tx` lets the real code
    // path execute, so the assertions below test what actually happens.
    prismaMock.$transaction.mockImplementation((async (fn: (tx: unknown) => unknown) =>
      fn(prismaMock)) as never);
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
    // E5 — a manual release declares the WHOLE bay empty. Before this, the
    // release wrote only the legacy `status`, leaving the compartment columns
    // stale; assignment reads those, so the bay stayed unassignable forever.
    // Assert both compartments are actually cleared, not just that a write
    // happened.
    expect(prismaMock.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          topStatus: "AVAILABLE",
          topRentalId: null,
          bottomStatus: "AVAILABLE",
          bottomRentalId: null,
          status: "AVAILABLE",
        }),
      }),
    );
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

/**
 * setLockerService — putting a locker into or out of service from the console.
 *
 * Until 2026-09-19 nothing in the codebase could write `isOperational`; the
 * only way a bay had ever left service was a hand-run database script. These
 * pin what the toggle is allowed to do, and — as importantly — what it must
 * never do: erase or strand an item already inside the bay.
 */
describe("setLockerService — in/out of service from the admin console", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    // setOperational re-derives the whole-bay status inside a transaction;
    // hand the mock in as `tx` so the real write path runs.
    prismaMock.$transaction.mockImplementation((async (fn: (tx: unknown) => unknown) =>
      fn(prismaMock)) as never);
  });

  function svcReq(lockerNumber: string, body: Record<string, unknown>): AuthRequest {
    return {
      params: { lockerNumber },
      body,
      user: { userId: "admin-1", email: "admin@x.com", studentId: "s", role: "ADMIN" },
      app: { get: () => undefined },
    } as unknown as AuthRequest;
  }

  const EMPTY_BAY = {
    id: "locker-4",
    lockerNumber: "4",
    kioskId: "kiosk-1",
    isOperational: false,
    topStatus: "AVAILABLE",
    topRentalId: null,
    bottomStatus: "AVAILABLE",
    bottomRentalId: null,
  };

  it("rejects a request that does not say true or false", async () => {
    const next = jest.fn();
    await setLockerService(svcReq("4", { inService: "yes" }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(prismaMock.locker.update).not.toHaveBeenCalled();
  });

  it("404s an unknown locker and changes nothing", async () => {
    prismaMock.locker.findUnique.mockResolvedValue(null);
    const next = jest.fn();
    await setLockerService(svcReq("9", { inService: true }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(prismaMock.locker.update).not.toHaveBeenCalled();
  });

  it("puts a bay back in service and re-derives its status to AVAILABLE", async () => {
    prismaMock.locker.findUnique.mockResolvedValue(EMPTY_BAY as never);
    prismaMock.locker.update.mockResolvedValue({} as never);
    const res = makeRes();
    const next = jest.fn();

    await setLockerService(svcReq("4", { inService: true }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isOperational: true, status: "AVAILABLE" }),
      }),
    );
  });

  it("taking a bay out of service reports OUT_OF_SERVICE and never touches its compartments", async () => {
    prismaMock.locker.findUnique.mockResolvedValue({ ...EMPTY_BAY, isOperational: true } as never);
    prismaMock.locker.update.mockResolvedValue({} as never);

    await setLockerService(svcReq("4", { inService: false }), makeRes(), jest.fn());

    const written = (prismaMock.locker.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(written.isOperational).toBe(false);
    expect(written.status).toBe("OUT_OF_SERVICE");
    // The toggle must never erase or move an item — it only stops new deposits.
    for (const k of ["topStatus", "topRentalId", "bottomStatus", "bottomRentalId"]) {
      expect(written).not.toHaveProperty(k);
    }
  });

  it("warns when a bay taken out of service still holds an item", async () => {
    prismaMock.locker.findUnique.mockResolvedValue({
      ...EMPTY_BAY,
      isOperational: true,
      topStatus: "OCCUPIED",
      topRentalId: "rental-7",
    } as never);
    prismaMock.locker.update.mockResolvedValue({} as never);
    const res = makeRes();

    await setLockerService(svcReq("4", { inService: false }), res, jest.fn());

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data.warning).toMatch(/still holds an item/);
  });

  it("is a no-op when the bay is already in the requested state", async () => {
    prismaMock.locker.findUnique.mockResolvedValue(EMPTY_BAY as never); // already out
    const res = makeRes();

    await setLockerService(svcReq("4", { inService: false }), res, jest.fn());

    expect(prismaMock.locker.update).not.toHaveBeenCalled();
    expect((res.json as jest.Mock).mock.calls[0][0].data.changed).toBe(false);
  });
});
