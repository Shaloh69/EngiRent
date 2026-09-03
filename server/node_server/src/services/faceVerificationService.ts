/**
 * Face verification — the gate that opens a physical locker.
 *
 * Until 2026-09-03 this ran on the kiosk: a USB face camera, a `capture_face`
 * socket command, and the Pi calling the ML service itself. That camera has
 * been physically removed. Verification now happens on the user's own phone
 * (design mandate §2.13), which changes *where the photo is taken* and
 * nothing else about who is trusted:
 *
 *   The client captures an image. It NEVER asserts a result.
 *
 * The photo is uploaded to this server, which attaches ML_SERVICE_API_KEY
 * server-side and calls the ML service — the same reason POST
 * /auth/register-face proxies enrolment rather than letting the app hold that
 * key. This module then decides, and only this module emits the door command.
 * A client that could send `{verified: true}` would be a client that could
 * open any locker, so no code path here may take a caller-supplied verdict.
 *
 * The second trust boundary is the kiosk session (see kioskSessionStore.ts):
 * a caller must hold a session opened by the kiosk itself after it validated
 * the scanned QR token. This module never re-derives which kiosk to command
 * from anything the client sends.
 *
 * Ordering: every action now verifies BEFORE the door opens (deposit and
 * return used to open first and verify — or, for deposit, not verify at
 * all — during a 20s window after the fact). Verify-then-open is strictly
 * safer and gives all three actions (deposit/claim/return) the same shape.
 */

import axios from "axios";
import type { Server as SocketIOServer } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import env from "../config/env";
import { decryptFaceEncoding } from "../utils/crypto";
import { signedMediaUrl } from "./storageService";

/** Rental states in which someone can legitimately be standing at a kiosk. */
export const KIOSK_ACTIONABLE_STATUSES = [
  "AWAITING_DEPOSIT",
  "DEPOSITED",
  "ACTIVE",
] as const;

/** How long the owner/renter gets to place or retrieve the item once the
 *  door is open, before the kiosk is asked to photograph the locker for
 *  item-comparison. Matches the delay the old REST deposit/return handlers
 *  used. */
const ITEM_PLACEMENT_GRACE_MS = 20_000;

export interface FaceSubject {
  /** The user who must prove their identity for this step. */
  userId: string;
  /** Their enrolled 128-float encoding, already decrypted. */
  storedEncoding: number[] | null;
  /** Fallback reference photo URL when no encoding was ever captured. */
  referenceFaceUrl: string;
}

/**
 * Who has to show their face for this rental, right now?
 *
 * A deposit is performed by the **owner** dropping the item off; every later
 * step (claim, return) is the **renter**. Getting this backwards would let the
 * wrong party open the locker, so it is derived from rental status rather than
 * from anything the caller sends.
 */
export function resolveFaceSubject(rental: {
  status: string;
  ownerId: string;
  renterId: string | null;
  owner?: { profileImage: string | null; faceEncoding: unknown } | null;
  renter?: { profileImage: string | null; faceEncoding: unknown } | null;
}): FaceSubject {
  const isDeposit = rental.status === "AWAITING_DEPOSIT";
  const party = isDeposit ? rental.owner : rental.renter;

  return {
    userId: (isDeposit ? rental.ownerId : rental.renterId) ?? "",
    storedEncoding: decryptFaceEncoding(party?.faceEncoding ?? null),
    referenceFaceUrl: signedMediaUrl(party?.profileImage) ?? "",
  };
}

export interface MlFaceResult {
  detected: boolean;
  verified: boolean;
  confidence: number;
}

/**
 * Compare a captured face against the enrolled identity, via the ML service.
 *
 * Prefers the stored encoding (no image download or re-encode on the ML side)
 * and falls back to the reference photo URL for accounts enrolled before
 * encoding capture existed — the same priority the ML endpoint documents.
 *
 * Note there is deliberately **no local fallback** here. The kiosk used to
 * substitute a much weaker Haar-cascade check when the ML service was
 * unreachable, which meant a security-relevant downgrade could happen quietly.
 * If the model is unreachable now, this throws and the door stays shut.
 */
export async function compareFaceWithMl(
  imageBuffer: Buffer,
  mimeType: string,
  subject: FaceSubject,
): Promise<MlFaceResult> {
  const formData = new FormData();
  formData.append(
    "captured_image",
    new Blob([new Uint8Array(imageBuffer)], { type: mimeType }),
    "face.jpg",
  );
  formData.append("reference_image_url", subject.referenceFaceUrl);
  if (subject.storedEncoding) {
    formData.append("stored_encoding", JSON.stringify(subject.storedEncoding));
  }

  const resp = await axios.post(
    `${env.ML_SERVICE_URL}/api/v1/verify-face`,
    formData,
    {
      timeout: 20_000,
      headers: {
        ...(env.ML_SERVICE_API_KEY && { "X-API-Key": env.ML_SERVICE_API_KEY }),
      },
    },
  );

  const body = (resp.data ?? {}) as Record<string, unknown>;
  return {
    detected: Boolean(body.detected ?? body.face_detected),
    verified: Boolean(body.verified),
    confidence: Number(body.confidence ?? 0),
  };
}

/**
 * Find an available, operational locker at this specific kiosk, reserve it
 * for the rental, and command the kiosk to open its main door — then, after
 * a grace period for the person to place/retrieve the item, ask the kiosk to
 * photograph the locker for item comparison.
 *
 * This is the deposit/return half of what the old `/kiosk/deposit` and
 * `/kiosk/return` REST handlers each duplicated inline, now shared and now
 * scoped to the kiosk the person is actually standing at (the old lookups
 * picked "any AVAILABLE locker" with no kiosk filter — harmless with the
 * single deployed kiosk, but wrong in general).
 */
async function assignLockerAndOpen(
  io: SocketIOServer,
  kioskId: string,
  rentalId: string,
): Promise<{ lockerId: string; lockerNumber: string } | null> {
  const locker = await prisma.locker.findFirst({
    where: { status: "AVAILABLE", isOperational: true, kioskId },
  });
  if (!locker) return null;

  await prisma.locker.update({
    where: { id: locker.id },
    data: { status: "RESERVED", currentRentalId: rentalId, lastUsedAt: new Date() },
  });

  const lockerNumber = parseInt(locker.lockerNumber, 10);
  const kioskRoom = `kiosk:${kioskId}`;

  io.to(kioskRoom).emit("kiosk:command", {
    action: "open_door",
    locker_id: lockerNumber,
    door: "main_door",
    rental_id: rentalId,
  });

  setTimeout(() => {
    io.to(kioskRoom).emit("kiosk:command", {
      action: "capture_image",
      locker_id: lockerNumber,
      num_frames: 3,
      rental_id: rentalId,
    });
  }, ITEM_PLACEMENT_GRACE_MS);

  return { lockerId: locker.id, lockerNumber: locker.lockerNumber };
}

/**
 * Apply a *successful* verification: open the door, advance the rental, and
 * tell both the phone and the kiosk what happened.
 *
 * Call this only once `compareFaceWithMl` has returned `verified: true` — a
 * bad match never reaches here at all. The controller returns a retryable
 * failure straight from the HTTP response instead (see
 * kioskController.ts's verifyFaceFromApp), so a mismatch never touches the
 * database or the kiosk room. There is deliberately no `verified` parameter
 * on this function: an earlier version took one and had a branch for
 * `verified === false` that could never actually run, since the one caller
 * only ever invoked it after checking `result.verified` itself — a bad match
 * would have silently done nothing here.
 */
export async function applyFaceVerificationOutcome(params: {
  io: SocketIOServer;
  rentalId: string;
  kioskId: string;
  confidence: number;
}): Promise<{ action: "claim" | "return" | "deposit" | "none"; error?: string }> {
  const { io, rentalId, kioskId, confidence } = params;

  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: true,
      depositLocker: { select: { id: true, lockerNumber: true } },
    },
  });
  if (!rental) return { action: "none", error: "Rental not found" };

  const kioskRoom = `kiosk:${kioskId}`;

  // ── Deposit: owner is dropping the item off. Assign a locker now — none
  // exists yet at this stage, unlike claim below.
  if (rental.status === "AWAITING_DEPOSIT") {
    const assigned = await assignLockerAndOpen(io, kioskId, rentalId);
    if (!assigned) {
      io.to(`user:${rental.ownerId}`).emit("face:failed", {
        rentalId,
        confidence,
        kioskId,
        message: "No available locker at this kiosk right now",
      });
      return { action: "none", error: "No available locker" };
    }

    io.to(`user:${rental.ownerId}`).emit("face:verified", {
      rentalId,
      action: "deposit",
      kioskId,
    });
    logger.info(`Deposit face-verified for rental ${rentalId}, locker ${assigned.lockerNumber}`);
    return { action: "deposit" };
  }

  // ── Claim: DEPOSITED → ACTIVE. Re-open the SAME locker the item was
  // deposited into — already assigned by the deposit's item-verification
  // step, so it's read from the relation rather than picked fresh.
  if (rental.status === "DEPOSITED") {
    if (!rental.depositLocker) {
      logger.error(`Claim for rental ${rentalId} has no depositLocker — cannot open`);
      return { action: "none", error: "No locker on record for this rental" };
    }

    await prisma.rental.update({
      where: { id: rentalId },
      data: { status: "ACTIVE", claimedAt: new Date() },
    });

    io.to(kioskRoom).emit("kiosk:command", {
      action: "open_door",
      locker_id: parseInt(rental.depositLocker.lockerNumber, 10),
      door: "main_door",
      rental_id: rentalId,
    });

    await prisma.locker.update({
      where: { id: rental.depositLocker.id },
      data: { status: "AVAILABLE", currentRentalId: null },
    });

    await prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: "Item Claimed",
        message: `Your ${rental.item.title} has been claimed by the renter.`,
        type: "RENTAL_STARTED",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    });

    io.to(`user:${rental.renterId}`).emit("face:verified", {
      rentalId,
      action: "claim",
      kioskId,
    });
    io.to(`user:${rental.ownerId}`).emit("rental:active", { rentalId });
    logger.info(`Claim approved for rental ${rentalId}`);
    return { action: "claim" };
  }

  // ── Return: renter is bringing the item back. Assign a (possibly
  // different) locker, same as deposit.
  if (rental.status === "ACTIVE") {
    const assigned = await assignLockerAndOpen(io, kioskId, rentalId);
    if (!assigned) {
      io.to(`user:${rental.renterId}`).emit("face:failed", {
        rentalId,
        confidence,
        kioskId,
        message: "No available locker at this kiosk right now",
      });
      return { action: "none", error: "No available locker" };
    }

    io.to(`user:${rental.renterId}`).emit("face:verified", {
      rentalId,
      action: "return",
      kioskId,
    });
    return { action: "return" };
  }

  return { action: "none" };
}
