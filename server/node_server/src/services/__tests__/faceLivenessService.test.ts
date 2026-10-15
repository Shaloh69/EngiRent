/**
 * Face liveness helpers (2026-10-15): the challenge (random order + nonce),
 * enrolment challenges, reading the four frames, the ML call's fail-closed
 * shape, and the student-facing sentences.
 */
jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));

import axios from "axios";
import {
  FACE_STEPS,
  checkEnrolChallenge,
  checkLivenessWithMl,
  consumeEnrolChallenge,
  issueEnrolChallenge,
  livenessMessage,
  newFaceChallenge,
  nonceMatches,
  publicChallenge,
  readFaceFrames,
  type FaceFrames,
} from "../faceLivenessService";

const postMock = axios.post as jest.Mock;
const f = { buffer: Buffer.from("x"), mimetype: "image/jpeg" } as Express.Multer.File;
const FRAMES = { centre: f, blink: f, turn_left: f, turn_right: f } as FaceFrames;

describe("the challenge", () => {
  it("is always a permutation of all three steps", () => {
    for (let i = 0; i < 200; i++) {
      expect([...newFaceChallenge().order].sort()).toEqual([...FACE_STEPS].sort());
    }
  });

  it("can produce every one of the six orders", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) seen.add(newFaceChallenge().order.join(","));
    expect(seen.size).toBe(6);
  });

  it("is driven by the random source, not a fixed order", () => {
    expect(newFaceChallenge(() => 0).order).not.toEqual(newFaceChallenge((m) => m - 1).order);
  });

  it("has a fresh 128-bit nonce each time", () => {
    const a = newFaceChallenge().nonce;
    const b = newFaceChallenge().nonce;
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("is sent to the phone without the server's own timestamp", () => {
    const c = newFaceChallenge();
    expect(publicChallenge(c)).toEqual({ order: c.order, nonce: c.nonce });
  });

  it("compares nonces exactly and refuses anything malformed", () => {
    const n = newFaceChallenge().nonce;
    expect(nonceMatches(n, n)).toBe(true);
    expect(nonceMatches(n, n.slice(0, -1) + (n.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(nonceMatches(n, n.slice(1))).toBe(false);
    expect(nonceMatches(n, undefined)).toBe(false);
    expect(nonceMatches(n, 123)).toBe(false);
  });
});

describe("enrolment challenges", () => {
  afterEach(() => jest.useRealTimers());

  it("is per user and checks the nonce", () => {
    const c = issueEnrolChallenge("u1");
    expect(checkEnrolChallenge("u1", c.nonce)).toBe(c);
    expect(checkEnrolChallenge("u2", c.nonce)).toBeNull();
    expect(checkEnrolChallenge("u1", "f".repeat(32))).toBeNull();
  });

  it("a new challenge replaces the old one", () => {
    const old = issueEnrolChallenge("u3");
    issueEnrolChallenge("u3");
    expect(checkEnrolChallenge("u3", old.nonce)).toBeNull();
  });

  it("is gone once consumed", () => {
    const c = issueEnrolChallenge("u4");
    consumeEnrolChallenge("u4");
    expect(checkEnrolChallenge("u4", c.nonce)).toBeNull();
  });

  it("expires after five minutes", () => {
    jest.useFakeTimers();
    const c = issueEnrolChallenge("u5");
    jest.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect(checkEnrolChallenge("u5", c.nonce)).toBeNull();
  });
});

describe("reading the frames", () => {
  it("returns all four", () => {
    const req = { files: { centre: [f], blink: [f], turn_left: [f], turn_right: [f] } };
    expect(Object.keys(readFaceFrames(req as never))).toEqual(["centre", "blink", "turn_left", "turn_right"]);
  });

  it("tells an old app (one `file`) to update", () => {
    try {
      readFaceFrames({ files: { file: [f] } } as never);
      throw new Error("did not throw");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("APP_UPDATE_REQUIRED");
    }
  });

  it("refuses a set with one frame missing", () => {
    expect(() => readFaceFrames({ files: { centre: [f], blink: [f], turn_left: [f] } } as never)).toThrow();
  });
});

describe("the ML call", () => {
  beforeEach(() => postMock.mockReset());

  it("sends the four frames, the template and the flags to the liveness route", async () => {
    postMock.mockResolvedValue({ data: { passed: true, live: true, matched: true, distance: 0.3, metrics: {} } });
    const r = await checkLivenessWithMl(FRAMES, { storedEncoding: [0.1], returnEncoding: true, mirrored: true });
    expect(postMock.mock.calls[0][0]).toMatch(/\/api\/v1\/face\/liveness-verify$/);
    const form = postMock.mock.calls[0][1] as FormData;
    for (const k of ["centre", "blink", "turn_left", "turn_right"]) expect(form.get(k)).toBeTruthy();
    expect(form.get("stored_encoding")).toBe("[0.1]");
    expect(form.get("return_encoding")).toBe("true");
    expect(form.get("mirrored")).toBe("true");
    expect(r.passed && r.matched).toBe(true);
  });

  it("throws (fails closed) on a transport error", async () => {
    postMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(checkLivenessWithMl(FRAMES, {})).rejects.toThrow();
  });

  it("throws on a reply with no verdict rather than reading it as a pass", async () => {
    postMock.mockResolvedValue({ data: { detail: "weird" } });
    await expect(checkLivenessWithMl(FRAMES, {})).rejects.toThrow(/no verdict/);
  });

  it("drops an encoding that is not 128 floats", async () => {
    postMock.mockResolvedValue({ data: { passed: true, live: true, encoding: [1, 2, 3] } });
    expect((await checkLivenessWithMl(FRAMES, {})).encoding).toBeNull();
  });
});

describe("what the student is told", () => {
  it("says the hat sentence the user ruled on", () => {
    expect(livenessMessage("HAT")).toBe("Remove your hat and try again.");
  });

  it.each(["NO_FACE", "MULTIPLE_FACES", "SPOOF", "EYES_CLOSED", "NOT_FACING", "NO_BLINK",
    "TURN_LEFT_SHORT", "TURN_RIGHT_SHORT", "NOT_SAME_PERSON", "NO_MATCH"])("has a specific sentence for %s", (code) => {
    expect(livenessMessage(code)).not.toBe(livenessMessage("SOMETHING_ELSE"));
  });
});
