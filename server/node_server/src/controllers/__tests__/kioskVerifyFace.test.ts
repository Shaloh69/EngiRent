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
 * Face liveness (2026-10-15) adds:
 *   · an app from before the revamp (one `file`) is told to update, no ML call
 *   · the frames must answer the session's CURRENT challenge nonce; a stale
 *     one is refused (409) without costing an attempt
 *   · every failed attempt re-issues the challenge, so a nonce works once
 *   · an enrolment from before the revamp, or one waiting for review, never
 *     reaches ML
 *   · no stored template → refused (liveness alone must never open a door)
 *   · liveness that passed without `matched === true` never opens a door
 *
 * The session store is deliberately NOT mocked: it is the trust boundary, so
 * the real one is used and the real binding is what gets tested. Prisma and
 * the ML call are mocked, because neither is the subject here.
 */
import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

jest.mock("../../services/faceVerificationService", () => {
  const actual = jest.requireActual("../../services/faceVerificationService");
  return {
    __esModule: true,
    KIOSK_ACTIONABLE_STATUSES: ["AWAITING_DEPOSIT", "DEPOSITED", "ACTIVE"],
    // E6.R — the real gate, so these tests exercise what production runs.
    isKioskActionable: actual.isKioskActionable,
    FACE_UPDATE_REQUIRED: actual.FACE_UPDATE_REQUIRED,
    FACE_REVIEW_PENDING: actual.FACE_REVIEW_PENDING,
    resolveFaceSubject: jest.fn(),
    faceEnrolmentGate: jest.fn(),
    applyFaceVerificationOutcome: jest.fn(),
  };
});

jest.mock("../../services/faceLivenessService", () => ({
  ...jest.requireActual("../../services/faceLivenessService"),
  checkLivenessWithMl: jest.fn(),
}));

import prisma from "../../config/database";
import { verifyFaceFromApp } from "../kioskController";
import { AuthRequest } from "../../middleware/auth";
import {
  resolveFaceSubject,
  faceEnrolmentGate,
  applyFaceVerificationOutcome,
} from "../../services/faceVerificationService";
import { checkLivenessWithMl } from "../../services/faceLivenessService";
import {
  openKioskSession,
  getKioskSession,
  consumeKioskSession,
} from "../../services/kioskSessionStore";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const resolveSubjectMock = resolveFaceSubject as jest.Mock;
const gateMock = faceEnrolmentGate as jest.Mock;
const livenessMock = checkLivenessWithMl as jest.Mock;
const outcomeMock = applyFaceVerificationOutcome as jest.Mock;

const RENTAL_ID = "11111111-1111-4111-8111-111111111111";
const REAL_KIOSK = "KIOSK-001";
const RENTER = "renter-1";
const OWNER = "owner-1";
const TEMPLATE = Array.from({ length: 128 }, (_, i) => i / 1000);

const PASS = { passed: true, live: true, reason: null, step: null, matched: true, distance: 0.31, encoding: null, metrics: {} };
const NO_BLINK = { passed: false, live: false, reason: "NO_BLINK", step: "BLINK", matched: null, distance: null, encoding: null, metrics: {} };
const STRANGER = { passed: false, live: true, reason: "NO_MATCH", step: "CENTRE", matched: false, distance: 0.82, encoding: null, metrics: {} };

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const frame = () => [{ buffer: Buffer.from("frame"), mimetype: "image/jpeg" }];

/** A request shaped exactly like the app's multipart upload, answering the
 *  session's current challenge unless told otherwise, plus whatever extra
 *  body fields an attacker might hope are trusted. */
function makeReq(
  userId: string,
  extraBody: Record<string, unknown> = {},
  files: Record<string, unknown> = { centre: frame(), blink: frame(), turn_left: frame(), turn_right: frame() },
): AuthRequest {
  return {
    user: { userId, email: "a@b.com", studentId: "s1", role: "STUDENT" },
    files,
    body: { rentalId: RENTAL_ID, nonce: getKioskSession(RENTAL_ID)?.challenge.nonce, ...extraBody },
    app: { get: () => ({ to: () => ({ emit: jest.fn() }) }) },
  } as unknown as AuthRequest;
}

function mockActionableRental(storedEncoding: number[] | null = TEMPLATE) {
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
    storedEncoding,
    referenceFaceUrl: "https://example.invalid/face.jpg",
  });
}

beforeEach(() => {
  mockReset(prismaMock);
  livenessMock.mockReset();
  outcomeMock.mockReset();
  gateMock.mockReset();
  gateMock.mockResolvedValue(null);
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
    expect(livenessMock).not.toHaveBeenCalled();
    expect(outcomeMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not the user the session was opened for", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    const next = jest.fn();

    await verifyFaceFromApp(makeReq("a-different-student"), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.findUnique).not.toHaveBeenCalled();
    expect(livenessMock).not.toHaveBeenCalled();
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
    expect(livenessMock).not.toHaveBeenCalled();
  });

  // E6.R — an approved return stays in VERIFICATION with its item released for
  // the owner. This gate used to refuse VERIFICATION outright, which made the
  // owner's pickup unreachable however the rest was built.
  it("admits the OWNER of an approved return released for pickup, and checks their face", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, OWNER);
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "VERIFICATION",
      verificationStatus: "APPROVED",
      releaseRequestedAt: new Date(),
      retrievedAt: null,
      ownerId: OWNER,
      renterId: RENTER,
      owner: { profileImage: null, faceEncoding: null },
      renter: { profileImage: null, faceEncoding: null },
    } as never);
    resolveSubjectMock.mockReturnValue({ userId: OWNER, storedEncoding: TEMPLATE, referenceFaceUrl: "" });
    livenessMock.mockResolvedValue(STRANGER);

    await verifyFaceFromApp(makeReq(OWNER), makeRes(), jest.fn());

    expect(livenessMock).toHaveBeenCalled();
  });

  it("still refuses a return that is only under review (nothing released)", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, OWNER);
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "VERIFICATION",
      verificationStatus: "MANUAL_REVIEW",
      releaseRequestedAt: null,
      retrievedAt: null,
      ownerId: OWNER,
      renterId: RENTER,
    } as never);
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(OWNER), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/not actionable/i);
    expect(livenessMock).not.toHaveBeenCalled();
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
    resolveSubjectMock.mockReturnValue({ userId: OWNER, storedEncoding: TEMPLATE, referenceFaceUrl: "" });
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(livenessMock).not.toHaveBeenCalled();
  });
});

describe("verify-face — the kiosk id is never client-supplied", () => {
  it("opens the door at the session's kiosk, ignoring the body's kioskId/token", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    livenessMock.mockResolvedValue(PASS);
    outcomeMock.mockResolvedValue({ action: "claim" });

    const req = makeReq(RENTER, {
      // Everything an attacker might hope is trusted.
      kioskId: "KIOSK-EVIL",
      kiosk_id: "KIOSK-EVIL",
      token: "KIOSK-EVIL:deadbeef:9999999999:0000000000000000",
      userId: "somebody-else",
      verified: "true",
    });

    await verifyFaceFromApp(req, makeRes(), jest.fn());

    expect(outcomeMock).toHaveBeenCalledTimes(1);
    expect(outcomeMock.mock.calls[0][0].kioskId).toBe(REAL_KIOSK);
  });

  it("sends the ENROLLED template to ML, so the frames are matched against it", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    livenessMock.mockResolvedValue(PASS);
    outcomeMock.mockResolvedValue({ action: "claim" });

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), jest.fn());

    expect(livenessMock.mock.calls[0][1].storedEncoding).toBe(TEMPLATE);
  });
});

describe("verify-face — the liveness challenge", () => {
  it("tells an app from before the revamp to update, before any ML spend", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER, {}, { file: frame() }), makeRes(), next);

    expect(next.mock.calls[0][0].code).toBe("APP_UPDATE_REQUIRED");
    expect(livenessMock).not.toHaveBeenCalled();
  });

  it("refuses a stale nonce with the live challenge, and does not count it", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    const res = makeRes();

    await verifyFaceFromApp(makeReq(RENTER, { nonce: "0".repeat(32) }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.code).toBe("CHALLENGE_EXPIRED");
    expect(body.data.challenge.nonce).toBe(getKioskSession(RENTAL_ID)?.challenge.nonce);
    expect(livenessMock).not.toHaveBeenCalled();
    expect(getKioskSession(RENTAL_ID)?.attempts).toBe(0);
  });

  it("a nonce works once: a failed attempt issues a new order + nonce", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    livenessMock.mockResolvedValue(NO_BLINK);
    const first = getKioskSession(RENTAL_ID)!.challenge.nonce;
    const res = makeRes();

    await verifyFaceFromApp(makeReq(RENTER), res, jest.fn());

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data.challenge.nonce).not.toBe(first);
    expect(body.data.challenge.nonce).toBe(getKioskSession(RENTAL_ID)?.challenge.nonce);
    expect(body.message).toMatch(/blink/i);

    // Replaying the first attempt's nonce is now refused, not judged.
    const replay = makeRes();
    await verifyFaceFromApp(makeReq(RENTER, { nonce: first }), replay, jest.fn());
    expect(replay.status).toHaveBeenCalledWith(409);
    expect(livenessMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an enrolment from before the revamp without calling ML", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    gateMock.mockResolvedValue({ code: "FACE_UPDATE_REQUIRED", message: "Update your face", kioskMessage: "x" });
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next.mock.calls[0][0].code).toBe("FACE_UPDATE_REQUIRED");
    expect(gateMock).toHaveBeenCalledWith(RENTER);
    expect(livenessMock).not.toHaveBeenCalled();
  });

  it("refuses when there is no template: liveness alone never opens a door", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental(null);
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next.mock.calls[0][0].code).toBe("FACE_UPDATE_REQUIRED");
    expect(livenessMock).not.toHaveBeenCalled();
  });

  it("a live stranger is refused with an attempt recorded", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    livenessMock.mockResolvedValue(STRANGER);
    const res = makeRes();

    await verifyFaceFromApp(makeReq(RENTER), res, jest.fn());

    expect(outcomeMock).not.toHaveBeenCalled();
    expect((res.json as jest.Mock).mock.calls[0][0].data.reason).toBe("NO_MATCH");
  });

  it("never opens on passed liveness without matched === true", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    livenessMock.mockResolvedValue({ ...PASS, matched: null });

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), jest.fn());

    expect(outcomeMock).not.toHaveBeenCalled();
    expect(getKioskSession(RENTAL_ID)?.attempts).toBe(1);
  });
});

describe("verify-face — failure modes", () => {
  it("fails closed when the ML service is unreachable, without burning a retry", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    livenessMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const nonceBefore = getKioskSession(RENTAL_ID)!.challenge.nonce;
    const next = jest.fn();

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/unavailable/i);
    // No door, and the session survives intact — an outage is not a bad match,
    // so the same challenge stands and the frames can simply be resent.
    expect(outcomeMock).not.toHaveBeenCalled();
    expect(getKioskSession(RENTAL_ID)?.attempts).toBe(0);
    expect(getKioskSession(RENTAL_ID)?.challenge.nonce).toBe(nonceBefore);
  });

  it("records an attempt on a failed check and never opens a door", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    livenessMock.mockResolvedValue(NO_BLINK);
    const res = makeRes();

    await verifyFaceFromApp(makeReq(RENTER), res, jest.fn());

    expect(outcomeMock).not.toHaveBeenCalled();
    expect(getKioskSession(RENTAL_ID)?.attempts).toBe(1);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data.verified).toBe(false);
    expect(payload.data.mustRescan).toBe(false);
    expect(payload.data.attemptsRemaining).toBe(3);
  });

  it("forces a re-scan after the fourth failed check", async () => {
    openKioskSession(RENTAL_ID, REAL_KIOSK, RENTER);
    mockActionableRental();
    livenessMock.mockResolvedValue(STRANGER);

    let res = makeRes();
    for (let i = 0; i < 4; i++) {
      res = makeRes();
      await verifyFaceFromApp(makeReq(RENTER), res, jest.fn());
    }

    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data.mustRescan).toBe(true);
    expect(payload.data.challenge).toBeNull();
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
    livenessMock.mockResolvedValue(PASS);
    outcomeMock.mockResolvedValue({ action: "claim" });
    const nonce = getKioskSession(RENTAL_ID)!.challenge.nonce;

    await verifyFaceFromApp(makeReq(RENTER), makeRes(), jest.fn());
    expect(outcomeMock).toHaveBeenCalledTimes(1);

    // Replay of the exact same request.
    const next = jest.fn();
    await verifyFaceFromApp(makeReq(RENTER, { nonce }), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(outcomeMock).toHaveBeenCalledTimes(1);
  });
});
