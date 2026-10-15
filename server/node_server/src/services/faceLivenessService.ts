/**
 * Face liveness (2026-10-15, docs/redesign/SPEC-FACE-LIVENESS.md).
 *
 * The phone guides the student through BLINK, TURN_LEFT and TURN_RIGHT in an
 * order THIS server chose at random, then uploads one frame per step plus a
 * centred frame. Nothing the phone concluded is trusted: the frames go to the
 * ML service (server to server, with the key), which re-checks every step.
 *
 * What lives here:
 *   - the challenge: a random order + a single-use nonce. A kiosk challenge is
 *     stored in the kiosk session (kioskSessionStore.ts, the trust boundary);
 *     an enrolment challenge is stored per user below, 5 minutes.
 *   - reading the four frames out of a multipart request;
 *   - the ML call, which fails CLOSED (throws) when ML is unreachable;
 *   - the sentence a student sees for each ML reason code.
 */

import crypto from "crypto";
import axios from "axios";
import type { Request } from "express";
import env from "../config/env";
import { ValidationError } from "../utils/errors";

export const FACE_STEPS = ["BLINK", "TURN_LEFT", "TURN_RIGHT"] as const;
export type FaceStep = (typeof FACE_STEPS)[number];

export interface FaceChallenge {
  order: FaceStep[];
  nonce: string;
  issuedAt: number;
}

/** A uniformly random order (Fisher-Yates over crypto.randomInt) + a fresh
 *  128-bit nonce. `randomInt` is injectable for tests only. */
export function newFaceChallenge(
  randomInt: (max: number) => number = (max) => crypto.randomInt(max),
): FaceChallenge {
  const order = [...FACE_STEPS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { order, nonce: crypto.randomBytes(16).toString("hex"), issuedAt: Date.now() };
}

/** What the phone is sent: never `issuedAt`, which is the server's own. */
export function publicChallenge(c: FaceChallenge): { order: FaceStep[]; nonce: string } {
  return { order: c.order, nonce: c.nonce };
}

/** Constant-time nonce comparison; false for anything malformed. */
export function nonceMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

// ── Enrolment challenges (profile setup and "Update your face") ─────────────

const ENROL_TTL_MS = 5 * 60_000;
const enrolChallenges = new Map<string, FaceChallenge>();

export function issueEnrolChallenge(userId: string): FaceChallenge {
  const c = newFaceChallenge();
  enrolChallenges.set(userId, c);
  return c;
}

/** The user's live enrolment challenge if `nonce` is its nonce, else null.
 *  Does NOT consume it: a re-enrolment that needs the password is resubmitted
 *  with the same frames and nonce (see consumeEnrolChallenge). */
export function checkEnrolChallenge(userId: string, nonce: unknown): FaceChallenge | null {
  const c = enrolChallenges.get(userId);
  if (!c) return null;
  if (Date.now() - c.issuedAt > ENROL_TTL_MS) {
    enrolChallenges.delete(userId);
    return null;
  }
  return nonceMatches(c.nonce, nonce) ? c : null;
}

export function consumeEnrolChallenge(userId: string): void {
  enrolChallenges.delete(userId);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, c] of enrolChallenges) if (now - c.issuedAt > ENROL_TTL_MS) enrolChallenges.delete(k);
}, 60_000).unref();

// ── Frames ──────────────────────────────────────────────────────────────────

export const FRAME_FIELDS = ["centre", "blink", "turn_left", "turn_right"] as const;
export const OPTIONAL_FRAME_FIELDS = ["blink2", "blink3"] as const;
export type FaceFrames = Record<(typeof FRAME_FIELDS)[number], Express.Multer.File> &
  Partial<Record<(typeof OPTIONAL_FRAME_FIELDS)[number], Express.Multer.File>>;

/** Code sent to an app too old to run the liveness check. */
export const APP_UPDATE_REQUIRED = "APP_UPDATE_REQUIRED";

/**
 * The four frames from a `uploadFaceFrames` request. An app from before the
 * revamp sends one `file`; it is told to update rather than given a
 * confusing "missing field" error.
 */
export function readFaceFrames(req: Request): FaceFrames {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
  const frames = {} as FaceFrames;
  for (const f of OPTIONAL_FRAME_FIELDS) {
    const extra = files[f]?.[0];
    if (extra) frames[f] = extra;
  }
  for (const f of FRAME_FIELDS) {
    const got = files[f]?.[0];
    if (!got) {
      throw Object.assign(
        new ValidationError("Update the EngiRent app to the latest version to verify your face"),
        { code: APP_UPDATE_REQUIRED },
      );
    }
    frames[f] = got;
  }
  return frames;
}

// ── The ML call ─────────────────────────────────────────────────────────────

export interface LivenessResult {
  passed: boolean;
  live: boolean;
  reason: string | null;
  step: string | null;
  matched: boolean | null;
  distance: number | null;
  encoding: number[] | null;
  metrics: Record<string, number>;
}

/**
 * POST the frames to ML /face/liveness-verify. Throws on any transport or
 * HTTP error (including ML's own 503 "models unavailable"): callers treat a
 * throw as "verification unavailable", never as a pass.
 */
export async function checkLivenessWithMl(
  frames: FaceFrames,
  opts: { storedEncoding?: number[] | null; returnEncoding?: boolean; mirrored?: boolean },
): Promise<LivenessResult> {
  const form = new FormData();
  for (const f of FRAME_FIELDS) {
    form.append(f, new Blob([new Uint8Array(frames[f].buffer)], { type: frames[f].mimetype }), `${f}.jpg`);
  }
  for (const f of OPTIONAL_FRAME_FIELDS) {
    const extra = frames[f];
    if (extra) form.append(f, new Blob([new Uint8Array(extra.buffer)], { type: extra.mimetype }), `${f}.jpg`);
  }
  if (opts.storedEncoding) form.append("stored_encoding", JSON.stringify(opts.storedEncoding));
  form.append("return_encoding", String(Boolean(opts.returnEncoding)));
  form.append("mirrored", String(Boolean(opts.mirrored)));

  const resp = await axios.post(`${env.ML_SERVICE_URL}/api/v1/face/liveness-verify`, form, {
    // Four frames, dlib + two ONNX models on a shared CPU: seconds, not ms.
    timeout: 45_000,
    headers: { ...(env.ML_SERVICE_API_KEY && { "X-API-Key": env.ML_SERVICE_API_KEY }) },
  });
  const b = (resp.data ?? {}) as Record<string, unknown>;
  if (typeof b.passed !== "boolean" || typeof b.live !== "boolean") {
    throw new Error("ML liveness response has no verdict");
  }
  return {
    passed: b.passed,
    live: b.live,
    reason: typeof b.reason === "string" ? b.reason : null,
    step: typeof b.step === "string" ? b.step : null,
    matched: typeof b.matched === "boolean" ? b.matched : null,
    distance: typeof b.distance === "number" ? b.distance : null,
    encoding: Array.isArray(b.encoding) && b.encoding.length === 128 ? (b.encoding as number[]) : null,
    metrics: (b.metrics as Record<string, number>) ?? {},
  };
}

/** The sentence the student sees. Plain words, one thing to do. */
export function livenessMessage(reason: string | null): string {
  switch (reason) {
    case "NO_FACE":
      return "We couldn't see your face. Hold the phone at eye level in good light and try again.";
    case "MULTIPLE_FACES":
      return "Only one person should be in the picture. Try again on your own.";
    case "HAT":
      return "Remove your hat and try again.";
    case "SPOOF":
      return "We need to see your real face, not a photo or a screen. Try again.";
    case "EYES_CLOSED":
      return "Keep your eyes open when you look straight at the camera.";
    case "NOT_FACING":
      return "Look straight at the camera at the start.";
    case "NO_BLINK":
      return "We didn't see you blink. Close your eyes fully for a moment when asked.";
    case "TURN_LEFT_SHORT":
      return "Turn your head further to the left.";
    case "TURN_RIGHT_SHORT":
      return "Turn your head further to the right.";
    case "TURN_LEFT_WRONG":
      return "You turned to the right. Turn your head to your left.";
    case "TURN_RIGHT_WRONG":
      return "You turned to the left. Turn your head to your right.";
    case "NOT_SAME_PERSON":
      return "The same person must do every step. Try again.";
    case "NO_MATCH":
      return "We couldn't match your face — please try again";
    default:
      return "We couldn't check your face. Please try again.";
  }
}
