/**
 * Face enrolment through liveness, the kiosk enrolment gate, and the admin
 * review (face liveness revamp, ruling 2026-10-15):
 *
 *   SETUP          a live face becomes the template, version 2
 *   RE-ENROL       matches the old template  -> replaced now, version 2
 *                  no match / no template    -> password, then admin review;
 *                                               the template is NOT replaced
 *   GATE           version < 2 or a face under review never reaches the ML call
 *   REVIEW         approve -> the pending face becomes the template; reject
 *                  -> discarded; the student is told either way
 *
 * The challenge store is real (it is part of what is being tested); Prisma,
 * storage, crypto, bcrypt and the ML call are mocked.
 */
import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("../../utils/crypto", () => ({
  encryptJson: (v: unknown) => ({ enc: v }),
  decryptFaceEncoding: (v: unknown) => (v && typeof v === "object" && "enc" in v ? (v as { enc: unknown }).enc : null),
}));
jest.mock("../../utils/bcrypt", () => ({ comparePassword: jest.fn() }));
jest.mock("../../services/storageService", () => ({
  ...jest.requireActual("../../services/storageService"),
  saveBuffer: jest.fn(),
  deleteStoredPath: jest.fn().mockResolvedValue(undefined),
  readStoredFile: jest.fn().mockResolvedValue(Buffer.from("pending")),
  storedFileExists: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/faceLivenessService", () => ({
  ...jest.requireActual("../../services/faceLivenessService"),
  checkLivenessWithMl: jest.fn(),
}));
jest.mock("../../services/auditLogService", () => ({ recordAudit: jest.fn() }));

import prisma from "../../config/database";
import { enrolFace, getFaceChallenge } from "../faceEnrolController";
import { decideFaceReview } from "../faceReviewController";
import { completeProfile } from "../authController";
import { faceEnrolmentGate } from "../../services/faceVerificationService";
import { checkLivenessWithMl, issueEnrolChallenge } from "../../services/faceLivenessService";
import { comparePassword } from "../../utils/bcrypt";
import { saveBuffer } from "../../services/storageService";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const mlMock = checkLivenessWithMl as jest.Mock;
const pwMock = comparePassword as jest.Mock;
const saveMock = saveBuffer as jest.Mock;

const U = "22222222-2222-4222-8222-222222222222";
const NEW = Array.from({ length: 128 }, () => 0.2);
const OLD = Array.from({ length: 128 }, () => 0.1);
const LIVE_MATCH = { passed: true, live: true, reason: null, step: null, matched: true, distance: 0.3, encoding: NEW, metrics: {} };
const LIVE_NO_MATCH = { ...LIVE_MATCH, passed: false, reason: "NO_MATCH", matched: false, distance: 0.8 };
const LIVE_NO_TEMPLATE = { ...LIVE_MATCH, matched: null, distance: null };
const HAT = { passed: false, live: false, reason: "HAT", step: "CENTRE", matched: null, distance: null, encoding: null, metrics: {} };

const f = [{ buffer: Buffer.from("centre-frame"), mimetype: "image/jpeg" }];
const FILES = { centre: f, blink: f, turn_left: f, turn_right: f };
const emit = jest.fn();

function res() {
  const r: Partial<Response> = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r as Response & { json: jest.Mock; status: jest.Mock };
}
function req(body: Record<string, unknown>, files: unknown = FILES, params: Record<string, string> = {}): AuthRequest {
  return {
    user: { userId: U, email: "s@x", studentId: "1", role: "STUDENT" },
    body,
    files,
    params,
    app: { get: () => ({ to: () => ({ emit }) }) },
  } as unknown as AuthRequest;
}
function account(over: Record<string, unknown> = {}) {
  prismaMock.user.findUnique.mockResolvedValue({
    id: U,
    password: "hash",
    faceEncoding: { enc: OLD },
    profileComplete: true,
    ...over,
  } as never);
}
const updateData = () => prismaMock.user.update.mock.calls[0][0].data as Record<string, unknown>;

beforeEach(() => {
  mockReset(prismaMock);
  mlMock.mockReset();
  pwMock.mockReset();
  saveMock.mockReset();
  emit.mockReset();
});

describe("GET /auth/face/challenge", () => {
  it("issues a random order of the three steps and a nonce", async () => {
    const r = res();
    await getFaceChallenge(req({}), r, jest.fn());
    const c = r.json.mock.calls[0][0].data.challenge;
    expect([...c.order].sort()).toEqual(["BLINK", "TURN_LEFT", "TURN_RIGHT"]);
    expect(c.nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("POST /auth/face/enrol", () => {
  it("refuses a stale nonce with a new challenge, before any ML call", async () => {
    issueEnrolChallenge(U);
    account();
    const r = res();
    await enrolFace(req({ nonce: "0".repeat(32) }), r, jest.fn());
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json.mock.calls[0][0].data.challenge.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(mlMock).not.toHaveBeenCalled();
  });

  it("SETUP: needs explicit biometric consent", async () => {
    const c = issueEnrolChallenge(U);
    account({ profileComplete: false, faceEncoding: null });
    const next = jest.fn();
    await enrolFace(req({ nonce: c.nonce }), res(), next);
    expect(next.mock.calls[0][0].message).toMatch(/consent/i);
    expect(mlMock).not.toHaveBeenCalled();
  });

  it("SETUP: a live face becomes the template, version 2, with no comparison", async () => {
    const c = issueEnrolChallenge(U);
    account({ profileComplete: false, faceEncoding: null });
    mlMock.mockResolvedValue(LIVE_NO_TEMPLATE);
    const r = res();
    await enrolFace(req({ nonce: c.nonce, biometricConsent: "true" }), r, jest.fn());
    expect(mlMock.mock.calls[0][1].storedEncoding).toBeNull();
    expect(updateData()).toMatchObject({ faceEncoding: { enc: NEW }, faceEnrolmentVersion: 2 });
    expect(saveMock.mock.calls[0][0]).toBe(`users/${U}/face.jpg`);
    expect(r.json.mock.calls[0][0].data.enrolled).toBe(true);
  });

  it("not live (a hat): nothing is saved, the student is told why, with a new challenge", async () => {
    const c = issueEnrolChallenge(U);
    account();
    mlMock.mockResolvedValue(HAT);
    const r = res();
    await enrolFace(req({ nonce: c.nonce }), r, jest.fn());
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
    const body = r.json.mock.calls[0][0];
    expect(body.message).toBe("Remove your hat and try again.");
    expect(body.data.challenge.nonce).not.toBe(c.nonce);
  });

  it("RE-ENROL: compares against the OLD template, and a match replaces it now", async () => {
    const c = issueEnrolChallenge(U);
    account();
    mlMock.mockResolvedValue(LIVE_MATCH);
    const r = res();
    await enrolFace(req({ nonce: c.nonce }), r, jest.fn());
    expect(mlMock.mock.calls[0][1].storedEncoding).toEqual(OLD);
    expect(updateData()).toMatchObject({ faceEncoding: { enc: NEW }, faceEnrolmentVersion: 2 });
    expect(r.json.mock.calls[0][0].data.enrolled).toBe(true);
  });

  it("RE-ENROL without a match: asks for the password, keeps the challenge, writes nothing", async () => {
    const c = issueEnrolChallenge(U);
    account();
    mlMock.mockResolvedValue(LIVE_NO_MATCH);
    const r = res();
    await enrolFace(req({ nonce: c.nonce }), r, jest.fn());
    expect(r.json.mock.calls[0][0].data).toMatchObject({ enrolled: false, needsPassword: true, reason: "NO_MATCH" });
    expect(prismaMock.user.update).not.toHaveBeenCalled();

    // The same frames + nonce are resent with the password: the nonce still works.
    pwMock.mockResolvedValue(true);
    const r2 = res();
    await enrolFace(req({ nonce: c.nonce, password: "pw" }), r2, jest.fn());
    expect(r2.status).not.toHaveBeenCalledWith(409);
    expect(r2.json.mock.calls[0][0].data.pendingReview).toBe(true);
  });

  it("RE-ENROL with the password: the face goes to REVIEW, the old template stays", async () => {
    const c = issueEnrolChallenge(U);
    account();
    mlMock.mockResolvedValue(LIVE_NO_MATCH);
    pwMock.mockResolvedValue(true);
    await enrolFace(req({ nonce: c.nonce, password: "pw" }), res(), jest.fn());
    const data = updateData();
    expect(data).toMatchObject({ pendingFaceEncoding: { enc: NEW }, pendingFaceReason: "NO_MATCH" });
    expect(data).not.toHaveProperty("faceEncoding");
    expect(data).not.toHaveProperty("faceEnrolmentVersion");
    expect(saveMock.mock.calls[0][0]).toBe(`users/${U}/face-pending.jpg`);
    expect(emit).toHaveBeenCalledWith("admin:face_review", expect.objectContaining({ userId: U }));
  });

  it("RE-ENROL with no old template at all also needs the password + review", async () => {
    const c = issueEnrolChallenge(U);
    account({ faceEncoding: null });
    mlMock.mockResolvedValue(LIVE_NO_TEMPLATE);
    const r = res();
    await enrolFace(req({ nonce: c.nonce }), r, jest.fn());
    expect(r.json.mock.calls[0][0].data).toMatchObject({ needsPassword: true, reason: "NO_TEMPLATE" });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("a wrong password writes nothing and ends the attempt", async () => {
    const c = issueEnrolChallenge(U);
    account();
    mlMock.mockResolvedValue(LIVE_NO_MATCH);
    pwMock.mockResolvedValue(false);
    const next = jest.fn();
    await enrolFace(req({ nonce: c.nonce, password: "guess" }), res(), next);
    expect(next.mock.calls[0][0].code).toBe("WRONG_PASSWORD");
    expect(prismaMock.user.update).not.toHaveBeenCalled();

    const r = res();
    await enrolFace(req({ nonce: c.nonce, password: "guess2" }), r, jest.fn());
    expect(r.status).toHaveBeenCalledWith(409);
  });

  it("fails closed when ML is down, and the challenge survives for a resend", async () => {
    const c = issueEnrolChallenge(U);
    account();
    mlMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const next = jest.fn();
    await enrolFace(req({ nonce: c.nonce }), res(), next);
    expect(next.mock.calls[0][0].message).toMatch(/unavailable/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();

    mlMock.mockResolvedValue(LIVE_MATCH);
    const r = res();
    await enrolFace(req({ nonce: c.nonce }), r, jest.fn());
    expect(r.json.mock.calls[0][0].data.enrolled).toBe(true);
  });

  it("tells an app from before the revamp to update", async () => {
    issueEnrolChallenge(U);
    const next = jest.fn();
    await enrolFace(req({ nonce: "x" }, { file: f }), res(), next);
    expect(next.mock.calls[0][0].code).toBe("APP_UPDATE_REQUIRED");
  });
});

describe("faceEnrolmentGate (the kiosk accepts only a liveness enrolment)", () => {
  it("version 1 must update", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ faceEnrolmentVersion: 1, faceEncoding: { enc: OLD }, pendingFaceAt: null } as never);
    expect((await faceEnrolmentGate(U))?.code).toBe("FACE_UPDATE_REQUIRED");
  });

  it("version 2 with no template must update", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ faceEnrolmentVersion: 2, faceEncoding: null, pendingFaceAt: null } as never);
    expect((await faceEnrolmentGate(U))?.code).toBe("FACE_UPDATE_REQUIRED");
  });

  it("a face waiting for review is refused, even over an older version 2", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ faceEnrolmentVersion: 2, faceEncoding: { enc: OLD }, pendingFaceAt: new Date() } as never);
    expect((await faceEnrolmentGate(U))?.code).toBe("FACE_REVIEW_PENDING");
  });

  it("version 2 with a template passes", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ faceEnrolmentVersion: 2, faceEncoding: { enc: NEW }, pendingFaceAt: null } as never);
    expect(await faceEnrolmentGate(U)).toBeNull();
  });

  it("an unknown user is refused", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await faceEnrolmentGate(U)).not.toBeNull();
  });
});

describe("POST /admin/face-reviews/:id", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => unknown)(prismaMock));
  });

  it("APPROVE: the pending face becomes the template, version 2, pending cleared", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: U, pendingFaceAt: new Date(), pendingFaceEncoding: { enc: NEW } } as never);
    await decideFaceReview(req({ decision: "APPROVE" }, undefined, { id: U }), res(), jest.fn());
    expect(updateData()).toMatchObject({ faceEncoding: { enc: NEW }, faceEnrolmentVersion: 2, pendingFaceAt: null });
    expect(saveMock.mock.calls[0][0]).toBe(`users/${U}/face.jpg`);
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it("REJECT: the pending face is discarded and the template is untouched", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: U, pendingFaceAt: new Date(), pendingFaceEncoding: { enc: NEW } } as never);
    await decideFaceReview(req({ decision: "REJECT", note: "Not the same person" }, undefined, { id: U }), res(), jest.fn());
    const data = updateData();
    expect(data).toMatchObject({ pendingFaceAt: null });
    expect(data).not.toHaveProperty("faceEncoding");
    expect(data).not.toHaveProperty("faceEnrolmentVersion");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("refuses when nothing is waiting", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: U, pendingFaceAt: null, pendingFaceEncoding: null } as never);
    const next = jest.fn();
    await decideFaceReview(req({ decision: "APPROVE" }, undefined, { id: U }), res(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("POST /auth/profile/complete after the revamp", () => {
  const body = { biometricConsent: true, guardianConsent: true, parentName: "Parent Name", parentContact: "09171234567" };

  it("an encoding the CLIENT supplies (old app) is written as version 1, never 2", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ faceEncoding: null, faceEnrolmentVersion: 1 } as never);
    prismaMock.user.update.mockResolvedValue({ id: U } as never);
    await completeProfile(req({ ...body, faceEncoding: OLD }), res(), jest.fn());
    expect(updateData()).toMatchObject({ faceEncoding: { enc: OLD }, faceEnrolmentVersion: 1 });
  });

  it("the new app sends no encoding: the server's liveness template is kept as is", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ faceEncoding: { enc: NEW }, faceEnrolmentVersion: 2 } as never);
    prismaMock.user.update.mockResolvedValue({ id: U } as never);
    const next = jest.fn();
    await completeProfile(req(body), res(), next);
    expect(next).not.toHaveBeenCalled();
    const data = updateData();
    expect(data).not.toHaveProperty("faceEncoding");
    expect(data).not.toHaveProperty("faceEnrolmentVersion");
  });

  it("no encoding and no liveness enrolment is still refused (D-39)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ faceEncoding: null, faceEnrolmentVersion: 1 } as never);
    const next = jest.fn();
    await completeProfile(req(body), res(), next);
    expect(next.mock.calls[0][0].message).toMatch(/faceEncoding is required/);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
