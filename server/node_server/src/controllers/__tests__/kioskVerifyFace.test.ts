/**
 * E1 — `POST /kiosk/verify-face`, attacked rather than exercised.
 *
 * This endpoint is the one place in the product where a client request can
 * end with a physical locker door opening, so `API-TEST-PLAN.md` lists it
 * first under "specifically risky". The properties asserted here are the ones
 * the 2026-09-03 session-binding fix exists to guarantee:
 *
 *   · no live kiosk session  → rejected before any ML call
 *   · session belongs to someone else → rejected before the rental is read
 *   · a client-supplied kioskId/token is IGNORED — the kiosk id that reaches
 *     the door command comes only from the session the kiosk itself opened
 *   · the ML service being unreachable fails CLOSED, and does not burn the
 *     user's retry budget
 *   · a verified match is single-use — the same session cannot open a second
 *     door
 *
 * The session store is deliberately NOT mocked: it is the trust boundary, so
 * the real one is used and the real binding is what gets tested. Prisma and
 * the ML calls are mocked, because neither is the subject here.
 */
import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

jest.mock("../../services/faceVerificationService", () => ({
  __esModule: true,
  KIOSK_ACTIONABLE_STATUSES: ["AWAITING_DEPOSIT", "DEPOSITED", "ACTIVE"],
  resolveFaceSubject: jest.fn(),
  compareFaceWithMl: jest.fn(),
  applyFaceVerificationOutcome: jest.fn(),
}));

import prisma from "../../config/database";
import { verifyFaceFromApp } from "../kioskController";
import { AuthRequest } from "../../middleware/auth";
import {
  resolveFaceSubject,
  compareFaceWithMl,
  applyFaceVerificationOutcome,
} from "../../services/faceVerificationService";
import {
  openKioskSession,
  getKioskSession,
  consumeKioskSession,
} from "../../services/kioskSessionStore";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const resolveSubjectMock = resolveFaceSubject as jest.Mock;
const compareMock = compareFaceWithMl as jest.Mock;
const outcomeMock = applyFaceVerificationOutcome as jest.Mock;

const RENTAL_ID = "11111111-1111-4111-8111-111111111111";
const REAL_KIOSK = "KIOSK-001";
const RENTER = "renter-1";
const OWNER = "owner-1";

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

/** A request shaped exactly like the app's multipart upload, plus whatever
 *  extra body fields an attacker might hope are trusted. */
function makeReq(
  userId: string,
  extraBody: Record<string, unknown> = {},
): AuthRequest {
  return {
    user: { userId, email: "a@b.com", studentId: "s1", role: "STUDENT" },
    file: { buffer: Buffer.from("not-a-real-face"), mimetype: "image/jpeg" },
    body: { rentalId: RENTAL_ID, ...extraBody },
    app: { get: () => ({ to: () => ({ emit: jest.fn() }) }) },
  } as unknown as AuthRequest;
}

function mockActionableRental() {
  prismaMock.rental.findUnique.mockResolvedValue({
    id: RENTAL_ID,
    status: "DEPOSITED",
    ownerId: OWNER,
    renterId: RENTER,
    owner: { profileImage: null, faceEncoding: null },
    renter: { profileImage: null, faceEncoding: null },
  } as never);
  resolveSubjectMock.mockReturnValue({
    userId: RENTER,
    storedEncoding: [0.1, 0.2],
    referenceFaceUrl: "https://example.invalid/face.jpg",
  });
}

beforeEach(() => {
  mockReset(prismaMock);
  consumeKioskSession(RENTAL_ID);
});
afterEach(() => consumeKioskSession(RENTAL_ID));

describe("verify-face — a live kiosk session is required", () => {
  it("rejects when nobody has scanned the kiosk QR for this rental", async () => {
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/scan the kiosk QR code again/i);
    // Rejected before the rental is even read, and before any ML spend.
    expect(prismaMock.rental.findUnique).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
    expect(outcomeMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not the user the session was opened for", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    const next = jest.fn();

    // Somebody else's phone, holding a valid token of their own, aiming at
    // this rental id.
    await verifyFaceFromApp(makeReq("a-different-student"), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.findUnique).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("rejects when the rental is not in a kiosk-actionable status", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "COMPLETED",
      ownerId: OWNER,
      renterId: RENTER,
    } as never);
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("rejects when the rental's own state names a different person", async () => {
    // The session says this user, but the rental's status makes the OWNER the
    // subject — an independent second check of the same fact, which must win.
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "AWAITING_DEPOSIT",
      ownerId: OWNER,
      renterId: RENTER,
      owner: { profileImage: null, faceEncoding: null },
      renter: { profileImage: null, faceEncoding: null },
    } as never);
    resolveSubjectMock.mockReturnValue({
      userId: OWNER,
      storedEncoding: [0.1],
      referenceFaceUrl: "https://example.invalid/owner.jpg",
    });
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(compareMock).not.toHaveBeenCalled();
  });
});

describe("verify-face — the kiosk id is never client-supplied", () => {
  it("opens the door at the session's kiosk, ignoring the body's kioskId/token", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    compareMock.mockResolvedValue({ detected: true, verified: true, confidence: 0.97 });
    outcomeMock.mockResolvedValue({ action: "claim" });

    const req = makeReq(RENTER, {
      // Everything an attacker might hope is trusted.
      kioskId: "KIOSK-EVIL",
      kiosk_id: "KIOSK-EVIL",
      token: "KIOSK-EVIL:deadbeef:9999999999:0000000000000000",
      userId: "somebody-else",
    });

    await verifyFaceFromApp(req, makeRes(), jest.fn());

    expect(outcomeMock).toHaveBeenCalledTimes(1);
    expect(outcomeMock.mock.calls[0][0].kioskId).toBe(REAL_KIOSK);
  });
});

describe("verify-face — failure modes", () => {
  it("fails closed when the ML service is unreachable, without burning a retry", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    compareMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/unavailable/i);
    // No door, and the session survives intact — an outage is not a bad match.
    expect(outcomeMock).not.toHaveBeenCalled();
    expect(getKioskSession(RENTAL_ID)?.attempts).toBe(0);
  });

  it("records an attempt on a failed match and never opens a door", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    compareMock.mockResolvedValue({ detected: true, verified: false, confidence: 0.31 });
    const res = makeRes();

    await verifyFaceFromApp(makeReq(RENTER), res, jest.fn());

    expect(outcomeMock).not.toHaveBeenCalled();
    expect(getKioskSession(RENTAL_ID)?.attempts).toBe(1);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data.verified).toBe(false);
    expect(payload.data.mustRescan).toBe(false);
    expect(payload.data.attemptsRemaining).toBe(3);
  });

  it("forces a re-scan after the fourth failed match", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    compareMock.mockResolvedValue({ detected: true, verified: false, confidence: 0.2 });

    let res = makeRes();
    for (let i = 0; i < 4; i++) {
      res = makeRes();
      await verifyFaceFromApp(makeReq(RENTER), res, jest.fn());
    }

    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data.mustRescan).toBe(true);
    expect(getKioskSession(RENTAL_ID)).toBeUndefined();

    // And the very next try is refused outright rather than granted a fresh
    // budget against the same open session.
    const next = jest.fn();
    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it("is single-use — a verified match cannot open a second door", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    compareMock.mockResolvedValue({ detected: true, verified: true, confidence: 0.99 });
    outcomeMock.mockResolvedValue({ action: "claim" });

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), jest.fn());
    expect(outcomeMock).toHaveBeenCalledTimes(1);

    // Replay of the exact same request.
    const next = jest.fn();
    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(outcomeMock).toHaveBeenCalledTimes(1);
  });
});
