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

import type { Server as SocketIOServer } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { decryptFaceEncoding } from "../utils/crypto";
import { grantBayAccess } from "./kioskBayAccessStore";
// E5 — one definition of "long lead", "usable bay" and "which door holds it".
import {
  pickBayForDeposit,
  doorHoldingRental,
  isLongLeadPickup,
} from "./pickupLaneService";
import { recordCompartmentAfterCommit, setCompartment } from "./lockerCompartments";
import { completeAfterOwnerPickup } from "./returnApprovalService";
import { signedMediaUrl } from "./storageService";
import {
  emitLockerOccupancy,
  emitOccupancyForLockerId,
} from "./lockerOccupancyService";

/** Rental states in which someone can legitimately be standing at a kiosk. */
export const KIOSK_ACTIONABLE_STATUSES = [
  "AWAITING_DEPOSIT",
  "DEPOSITED",
  "ACTIVE",
] as const;

/**
 * Can this rental start a kiosk session at all?
 *
 * The three statuses above, OR an item released and waiting for its owner
 * whatever the status says (E4.6 / E6.R). Without the second half the retrieve
 * branch below was unreachable after a return: both kiosk gates refused
 * VERIFICATION before it got a look, so an owner told "scan the kiosk QR to
 * open it" could not. Who may open it is still decided by resolveFaceSubject
 * alone — in this state that is the owner and nobody else.
 */
export function isKioskActionable(rental: {
  status: string;
  releaseRequestedAt?: Date | null;
  retrievedAt?: Date | null;
}): boolean {
  if (KIOSK_ACTIONABLE_STATUSES.includes(rental.status as never)) return true;
  // Dispute v2 (ruling 6): the renter of a DISPUTED rental comes to the kiosk
  // to pay and return the correct item. Whether their case actually has
  // something to do is checked where the visit starts (startDisputeVisit) and,
  // for a straight answer at the kiosk, in kiosk:flow_start.
  if (rental.status === "DISPUTED") return true;
  return rental.releaseRequestedAt != null && rental.retrievedAt == null;
}

/* The 20s placement grace that used to live here is gone. It was a blind
 * timer: the server opened a door, counted to twenty and photographed the bay
 * whatever had happened in between. A person still reading their phone missed
 * it, and a RETRY verdict re-opened the door with no second photo ever
 * scheduled (D-78). Both steps are now taps — see kioskBayAccessStore.ts. */

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
 *
 * E4.6 adds a third case, and it is the reason this function takes the
 * retrieval fields as well as the status. Once an item has been **released**
 * into the lower compartment it belongs to the **owner** again — whatever the
 * rental status says. A DISPUTED or CANCELLED rental still has a renter, and
 * without this check that renter would face-match their way into a bottom door
 * holding an item the system just took back off them (failure mode F5).
 *
 * The retrieval state is read from the rental's own columns rather than from
 * anything the kiosk or phone sends, exactly like the original rule.
 */
export function resolveFaceSubject(rental: {
  status: string;
  ownerId: string;
  renterId: string | null;
  releaseRequestedAt?: Date | null;
  retrievedAt?: Date | null;
  owner?: { profileImage: string | null; faceEncoding: unknown } | null;
  renter?: { profileImage: string | null; faceEncoding: unknown } | null;
}): FaceSubject {
  // E4.6 / F5 — an item in (or on its way to) the lower compartment is the
  // owner's to collect. Checked FIRST so it wins over the status rule.
  const awaitingRetrieval =
    rental.releaseRequestedAt != null && rental.retrievedAt == null;

  const isOwner = awaitingRetrieval || rental.status === "AWAITING_DEPOSIT";
  const party = isOwner ? rental.owner : rental.renter;

  return {
    userId: (isOwner ? rental.ownerId : rental.renterId) ?? "",
    storedEncoding: decryptFaceEncoding(party?.faceEncoding ?? null),
    referenceFaceUrl: signedMediaUrl(party?.profileImage) ?? "",
  };
}

/** Codes the app acts on (opens "Update your face", or explains the wait). */
export const FACE_UPDATE_REQUIRED = "FACE_UPDATE_REQUIRED";
export const FACE_REVIEW_PENDING = "FACE_REVIEW_PENDING";

/**
 * F2b (ruling 2026-10-15): only a face enrolled through the liveness flow
 * (version 2) passes a kiosk face step. Returns why not, or null when this
 * user may proceed. Checked when the kiosk session would open (so nobody is
 * walked through the steps for nothing) AND again in /kiosk/verify-face
 * (the server-side guarantee).
 */
export async function faceEnrolmentGate(
  userId: string,
): Promise<{ code: string; message: string; kioskMessage: string } | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { faceEnrolmentVersion: true, faceEncoding: true, pendingFaceAt: true },
  });
  if (u?.pendingFaceAt) {
    return {
      code: FACE_REVIEW_PENDING,
      message: "Your new face is waiting for an admin to approve it. You can use the kiosk once it is approved.",
      kioskMessage: "This account's new face is waiting for approval. Please try again later.",
    };
  }
  if (!u || u.faceEnrolmentVersion < 2 || !u.faceEncoding) {
    return {
      code: FACE_UPDATE_REQUIRED,
      message: "Update your face with the new system first: open the EngiRent app home screen and tap \"Update your face\". Then scan the kiosk again.",
      kioskMessage: "Update your face in the EngiRent app first, then scan again.",
    };
  }
  return null;
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
export async function assignLocker(
  io: SocketIOServer,
  kioskId: string,
  rentalId: string,
  longLead = false,
  /**
   * Dispute v2 — bays holding this rental's uncollected WRONG item. Excluded
   * before anything else, including the resume rule below: a wrong item not
   * yet dropped sits in an upper compartment that records this rental's id,
   * and "resume in the same bay" would put the correct item on top of it.
   */
  excludeLockerIds: string[] = [],
): Promise<{ lockerId: string; lockerNumber: string } | null> {
  // E5.5. This used to ask for `status: "AVAILABLE"` on the whole bay, which
  // was correct while a bay was one space. Now a bay can have a free upper
  // compartment and an occupied lower one, and whether that bay is usable
  // depends on the deposit: a same-day hand-off only needs the upper
  // compartment, while a long-lead deposit ALSO needs the lower one free,
  // because it is going to be dropped down there once its full check passes.
  //
  // Assigning a long-lead deposit to a bay with a full lower compartment would
  // leave an item with nowhere to go — it would either have to stack on
  // someone else's property (the invariant at `AWAITING_RETRIEVAL` forbids it)
  // or occupy the upper bay indefinitely, which defeats the whole feature.
  //
  // Candidates are filtered in code rather than SQL so `canAcceptDeposit` stays
  // the single definition of "usable" — see pickupLaneService.
  const candidates = (
    await prisma.locker.findMany({
      where: { kioskId, isOperational: true },
      orderBy: { lockerNumber: "asc" },
    })
  ).filter((l) => !excludeLockerIds.includes(l.id));

  // D-89 — RESUME IN THE SAME BAY. A deposit can be interrupted and re-entered
  // (the bay-access grant expires, the person re-scans the QR after a retry,
  // the phone drops out). Its bay is still RESERVED for it, so the search
  // below — which only accepts a FREE upper compartment — skipped it and
  // assigned a second bay. The first stayed RESERVED for a rental that had
  // moved on: permanently unassignable, and possibly with the item still
  // inside it. Found 2026-09-19 with a real glue gun sitting in bay 1 after
  // four retries.
  //
  // So a bay already holding this rental in its upper compartment is reused,
  // before anything else is considered. Only an operational one: a bay taken
  // out of service mid-deposit should not be forced back into use.
  const resumed = candidates.find((l) => l.topRentalId === rentalId);
  if (resumed) {
    logger.info(
      `Deposit for rental ${rentalId} resumes in bay ${resumed.lockerNumber}, ` +
        `already reserved for it — not assigning a second bay`,
    );
    await emitLockerOccupancy(io, kioskId);
    return { lockerId: resumed.id, lockerNumber: resumed.lockerNumber };
  }

  // User ruling 2026-10-12: use every free compartment before saying "no
  // locker". A long-lead deposit prefers a bay whose lower compartment is free
  // too (it can drop once checked); failing that it takes a bay with only the
  // upper free and waits on top. See pickBayForDeposit.
  const picked = pickBayForDeposit(candidates, longLead);
  const locker = picked?.bay;
  if (picked?.waitsOnTop) {
    logger.info(
      `Long-lead deposit for rental ${rentalId} takes bay ${picked.bay.lockerNumber} with only its ` +
        `upper compartment free: it waits on top until the lower frees or the grace hour passes`,
    );
  }

  if (!locker) {
    logger.warn(
      `No bay at ${kioskId} can accept a ${longLead ? "long-lead" : "same-day"} deposit ` +
        `for rental ${rentalId}. Bays: ` +
        candidates
          .map((l) => `${l.lockerNumber}[top=${l.topStatus},bottom=${l.bottomStatus}]`)
          .join(" "),
    );
    return null;
  }

  // Through the single writer: reserve the UPPER compartment, and let the
  // whole-bay status be derived from both compartments (lockerCompartments).
  await setCompartment(
    locker.id,
    "top",
    { status: "RESERVED", rentalId },
    { lastUsedAt: new Date() },
  );

  // D-53: RESERVED means "spoken for", not free. Pushed before anything can
  // physically open, so the panel is never a step behind the hardware.
  await emitLockerOccupancy(io, kioskId);

  return { lockerId: locker.id, lockerNumber: locker.lockerNumber };
}

/**
 * Apply a *successful* verification: open the door, advance the rental, and
 * tell both the phone and the kiosk what happened.
 *
 * Call this only once the liveness check (faceLivenessService) has passed AND
 * matched the enrolled template — a
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
}): Promise<{
  action: "claim" | "return" | "deposit" | "retrieve" | "dispute_pay" | "none";
  error?: string;
  dispute?: { disputeId: string; amount: number; expiresAt: number; pendingTransactionId: string | null };
}> {
  const { io, rentalId, kioskId, confidence } = params;

  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: true,
      depositLocker: { select: { id: true, lockerNumber: true } },
      retrievalLocker: { select: { id: true, lockerNumber: true, kioskId: true } },
    },
  });
  if (!rental) return { action: "none", error: "Rental not found" };

  // ── Retrieve: E4.6, and it is checked FIRST because it outranks the status.
  //
  // The user's ruling: once the actuator has dropped an item into the lower
  // compartment, "the owner can then rescan the QR code for retrieving the item
  // in the bottom door". That is true whether the rental is DISPUTED, CANCELLED
  // or VERIFICATION — the item is the owner's to collect, so the status-based
  // branches below must not get a look at it.
  //
  // This opens **bottom_door**, the only place in the server that does. Every
  // other door command in this codebase is main_door.
  if (rental.releaseRequestedAt && !rental.retrievedAt) {
    if (!rental.retrievalLocker) {
      logger.error(
        `Retrieval for rental ${rentalId} has no retrievalLocker — cannot open`,
      );
      return { action: "none", error: "No retrieval bay on record" };
    }

    // Fail closed if the drop was never acknowledged: the item may still be in
    // the UPPER compartment, and opening the bottom door would show the owner
    // an empty box and mark their item collected (failure mode F3).
    if (!rental.releasedAt) {
      logger.warn(
        `Retrieval for rental ${rentalId} requested but the drop was never acknowledged`,
      );
      return { action: "none", error: "Item release not confirmed yet" };
    }

    // E5 — OPEN THE COMPARTMENT THAT ACTUALLY HOLDS THE OWNER'S ITEM.
    //
    // This hardcoded `bottom_door`, which was right while every release was an
    // actuator stroke down into the lower compartment. It no longer always is:
    // when the lower compartment is occupied by someone else's stored item,
    // requestRelease now releases the item IN PLACE in the upper compartment
    // rather than stroke it down on top of that one. Opening the bottom door
    // for that owner would show them a stranger's property.
    const retrievalBay = await prisma.locker.findUnique({
      where: { id: rental.retrievalLocker.id },
      select: { topRentalId: true, bottomRentalId: true },
    });
    const retrievalDoor = retrievalBay
      ? doorHoldingRental(retrievalBay, rentalId)
      : null;
    if (!retrievalDoor) {
      logger.error(
        `Retrieval for rental ${rentalId}: bay ${rental.retrievalLocker.lockerNumber} holds it ` +
          `in neither compartment. No door opened.`,
      );
      return {
        action: "none",
        error:
          "We can't tell which compartment holds your item. Please contact staff " +
          "rather than opening a door.",
      };
    }

    // E6.U (user report 2026-09-25: "it went to rental complete, no open
    // locker") — the face check only GRANTS, exactly like a claim since D-94.
    // "Open Kiosk Now" is what opens the door, marks the item retrieved, frees
    // the compartment and completes a passed return (completeRetrieval, run
    // from openBay). Opening here meant the door ran — 5s on bay 2 — without
    // a tap, and the phone jumped straight to "complete".
    grantBayAccess({
      rentalId,
      userId: rental.ownerId,
      kioskId,
      action: "retrieve",
      lockerNumber: rental.retrievalLocker.lockerNumber,
      door: retrievalDoor,
    });

    io.to(`user:${rental.ownerId}`).emit("face:verified", {
      rentalId,
      action: "retrieve",
      kioskId,
      lockerNumber: rental.retrievalLocker.lockerNumber,
    });
    logger.info(
      `Retrieval approved for rental ${rentalId}, bay ${rental.retrievalLocker.lockerNumber} ` +
        `${retrievalDoor}; awaiting the owner's open-bay tap`,
    );
    return { action: "retrieve" };
  }

  // Ruling 1 (Dispute v2): only a verified UCLM student lists or borrows, so a
  // deposit (the owner starts a hand-off) and a claim (the renter takes
  // possession) need a verified account, and a claim also needs the renter
  // not to be restricted by an open dispute (ruling 3). Returns and every
  // collection of a person's own item are never blocked: getting property
  // back must not depend on account standing.
  if (rental.status === "AWAITING_DEPOSIT" || rental.status === "DEPOSITED") {
    const actorId = rental.status === "AWAITING_DEPOSIT" ? rental.ownerId : rental.renterId;
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isVerified: true } });
    if (!actor?.isVerified) {
      const { NOT_VERIFIED_MESSAGE } = await import("../middleware/auth");
      return { action: "none", error: NOT_VERIFIED_MESSAGE };
    }
    if (rental.status === "DEPOSITED") {
      const { getRestriction } = await import("./disputeService");
      const r = await getRestriction(rental.renterId);
      if (r.restricted) {
        return { action: "none", error: `${r.reason} You can't collect a new item until it is resolved.` };
      }
    }
  }

  // ── Deposit: owner is dropping the item off. Assign a locker now — none
  // exists yet at this stage, unlike claim below.
  if (rental.status === "AWAITING_DEPOSIT") {
    // E5.5 — a long-lead deposit needs a bay whose LOWER compartment is also
    // free, because it will be dropped down there after its full check. A
    // same-day deposit only needs the upper compartment: it is collected from
    // there and never dropped. `include` above returns all Rental scalars, so
    // `pickupDate` is present.
    const longLead = isLongLeadPickup(rental.pickupDate);
    const assigned = await assignLocker(io, kioskId, rentalId, longLead);
    if (!assigned) {
      io.to(`user:${rental.ownerId}`).emit("face:failed", {
        rentalId,
        confidence,
        kioskId,
        message: "No available locker at this kiosk right now",
      });
      return { action: "none", error: "No available locker" };
    }

    // The door does NOT open here any more. The owner taps "Open Kiosk Now",
    // which is what lets them be standing at the bay with a hand free when it
    // unlocks, and what makes a RETRY recoverable at all (D-78): the same tap
    // re-opens it, and "Item is placed" is what asks for the photos.
    const grant = grantBayAccess({
      rentalId,
      userId: rental.ownerId,
      kioskId,
      action: "deposit",
      lockerNumber: assigned.lockerNumber,
      door: "main_door",
    });

    io.to(`user:${rental.ownerId}`).emit("face:verified", {
      rentalId,
      action: "deposit",
      kioskId,
      lockerNumber: assigned.lockerNumber,
      grantExpiresAt: grant.expiresAt,
    });
    logger.info(
      `Deposit face-verified for rental ${rentalId}, bay ${assigned.lockerNumber} reserved; ` +
        `awaiting the owner's open-bay tap`,
    );
    return { action: "deposit" };
  }

  // ── Claim: DEPOSITED → ACTIVE. Re-open the SAME locker the item was
  // deposited into — already assigned by the deposit's item-verification
  // step, so it's read from the relation rather than picked fresh.
  if (rental.status === "DEPOSITED") {
    // D-87d (ruling 2026-09-18) — DO NOT OPEN A BAY FOR AN UNCONFIRMED DEPOSIT.
    //
    // A deposit reaches DEPOSITED whatever the item check said: the APPROVED
    // and PENDING paths were the same code, so the only trace of "nobody has
    // confirmed this is the right item" was a `verificationStatus` column that
    // gated nothing. D-87b then made PENDING the normal outcome — the fast tier
    // structurally cannot approve — so in practice EVERY renter could collect
    // an unverified item, and the owner's protection was a review queue whose
    // decisions did nothing (see adminController, same date).
    //
    // The ruling: collection waits until either the full model clears it
    // (deepReviewQueue, ~35s) or a human does. This check is deliberately HERE,
    // in the function that opens the door, and not only at the socket entry
    // point: this is the trust boundary, and a gate that lives only in the
    // caller is one refactor away from being gone.
    if (rental.verificationStatus !== "APPROVED") {
      logger.warn(
        `Claim REFUSED for rental ${rentalId}: deposit not confirmed ` +
          `(verificationStatus=${rental.verificationStatus ?? "null"}). ` +
          `No bay opened.`,
      );
      return {
        action: "none",
        error:
          "This item is still being confirmed. You'll be notified as soon as " +
          "it's ready to collect — usually within a few minutes.",
      };
    }

    if (!rental.depositLocker) {
      logger.error(`Claim for rental ${rentalId} has no depositLocker — cannot open`);
      return { action: "none", error: "No locker on record for this rental" };
    }

    // E5.6 — OPEN THE COMPARTMENT THAT ACTUALLY HOLDS THE ITEM.
    //
    // This hardcoded `main_door`, which was right while an item could only
    // ever be in the upper compartment. Long-lead deposits are now dropped
    // into the LOWER compartment so the upper bay can serve another hand-off
    // (E5.4), so granting the upper door would open an empty space while the
    // renter's item sits behind the other one.
    //
    // Read from the bay's own per-compartment columns rather than inferred
    // from the pick-up date: the date says what we INTENDED, the columns say
    // where the item IS. If a drop failed, or a long-lead pick-up was brought
    // forward before the drop ran, only the columns are right.
    const bay = await prisma.locker.findUnique({
      where: { id: rental.depositLocker.id },
    });
    if (!bay) {
      logger.error(`Claim for rental ${rentalId}: bay row missing — cannot open`);
      return { action: "none", error: "No locker on record for this rental" };
    }

    const claimDoor = doorHoldingRental(bay, rentalId);
    if (!claimDoor) {
      // Neither compartment claims this rental. Refuse rather than guess: a
      // wrong guess opens a door onto someone else's property.
      logger.error(
        `Claim for rental ${rentalId}: bay ${bay.lockerNumber} holds it in neither ` +
          `compartment (top=${bay.topRentalId ?? "-"}, bottom=${bay.bottomRentalId ?? "-"}). ` +
          `No door opened.`,
      );
      return {
        action: "none",
        error:
          "We can't tell which compartment holds your item. Please contact staff " +
          "rather than opening a door — we don't want to hand you the wrong item.",
      };
    }

    // Granted, not opened: the renter taps "Open Kiosk Now" when they are in
    // front of the bay with a hand free, and can tap it again if the door
    // relocks before they have the item out.
    //
    // D-94 — nothing below commits the claim as DONE. It used to: this
    // branch flipped rental.status to ACTIVE and freed the compartment right
    // here, at approval time, before the door had ever actually opened. A
    // renter who cancelled after this point but before tapping "Open Kiosk
    // Now" left the database certain the item was collected when it was
    // still sitting in the compartment — and the next retry read ACTIVE as
    // "returning", not "still claiming", and opened the wrong (empty) door.
    // The commit (status, compartment, owner notification) now happens in
    // completeClaim(), called from kioskController.ts's openBay() — the one
    // place that actually sends the open_door command — on the grant's
    // first successful open, not on approval.
    const claimGrant = grantBayAccess({
      rentalId,
      userId: rental.renterId,
      kioskId,
      action: "claim",
      lockerNumber: rental.depositLocker.lockerNumber,
      door: claimDoor,
    });

    logger.info(
      `Claim for rental ${rentalId}: granted ${claimDoor} on bay ${bay.lockerNumber}`,
    );

    io.to(`user:${rental.renterId}`).emit("face:verified", {
      rentalId,
      action: "claim",
      kioskId,
      lockerNumber: rental.depositLocker.lockerNumber,
      grantExpiresAt: claimGrant.expiresAt,
    });
    return { action: "claim" };
  }

  // ── Dispute v2 (ruling 6): the renter pays AT THE KIOSK before the door
  // unlocks. A visit opens here, only because a face just verified; the door
  // is granted by disputeKioskService once the payment is confirmed (at once
  // if nothing is owed).
  if (rental.status === "DISPUTED") {
    const { startDisputeVisit } = await import("./disputeKioskService");
    const visit = await startDisputeVisit(io, { rentalId, userId: rental.renterId, kioskId });
    if (visit.action === "dispute_pay") {
      return {
        action: "dispute_pay",
        dispute: {
          disputeId: visit.disputeId,
          amount: visit.amount,
          expiresAt: visit.expiresAt,
          pendingTransactionId: visit.pendingTransactionId,
        },
      };
    }
    if (visit.action === "return") return { action: "return" };
    return { action: "none", error: visit.error };
  }

  // ── Return: renter is bringing the item back. Assign a (possibly
  // different) locker, same as deposit.
  if (rental.status === "ACTIVE") {
    const assigned = await assignLocker(io, kioskId, rentalId);
    if (!assigned) {
      io.to(`user:${rental.renterId}`).emit("face:failed", {
        rentalId,
        confidence,
        kioskId,
        message: "No available locker at this kiosk right now",
      });
      return { action: "none", error: "No available locker" };
    }

    const returnGrant = grantBayAccess({
      rentalId,
      userId: rental.renterId,
      kioskId,
      action: "return",
      lockerNumber: assigned.lockerNumber,
      door: "main_door",
    });

    io.to(`user:${rental.renterId}`).emit("face:verified", {
      rentalId,
      action: "return",
      kioskId,
      lockerNumber: assigned.lockerNumber,
      grantExpiresAt: returnGrant.expiresAt,
    });
    logger.info(
      `Return face-verified for rental ${rentalId}, bay ${assigned.lockerNumber} reserved; ` +
        `awaiting the renter's open-bay tap`,
    );
    return { action: "return" };
  }

  return { action: "none" };
}

/**
 * D-94 — actually commit a claim, once the door has actually opened.
 *
 * Called from kioskController.ts's openBay() ("Open Kiosk Now") on the first
 * successful open of a "claim" grant — the one place that actually sends the
 * open_door command for a claim. Everything here used to happen at face-
 * verification-approval time instead, before the renter had done anything
 * but scan a QR and hold up their phone. A renter who cancelled after
 * approval but before opening the door left the database certain the item
 * was collected — status ACTIVE, compartment freed — when it was still
 * sitting there, and the next retry read ACTIVE as "returning" and opened
 * the wrong door onto an empty compartment.
 *
 * `door` is the grant's own door, not re-derived: the grant already promised
 * a specific compartment when it was created, and nothing legitimately
 * changes that compartment's occupancy between grant and open now that this
 * function — not approval — is what frees it.
 */
/**
 * E6.U — the owner's pickup is committed when the door is actually sent to
 * open ("Open Kiosk Now"), not at face-verification: the same rule D-94 made
 * for a claim. Marks the item retrieved, frees ONLY the compartment it is
 * taken from (the other may hold another student's item), and completes a
 * passed return (E6.R). Safe on every open: the retrieved mark is conditional,
 * so a re-open does nothing further.
 */
export async function completeRetrieval(
  io: SocketIOServer,
  rentalId: string,
  door: "main_door" | "bottom_door",
): Promise<void> {
  const marked = await prisma.rental.updateMany({
    where: { id: rentalId, retrievedAt: null, releasedAt: { not: null } },
    data: { retrievedAt: new Date() },
  });
  if (marked.count === 0) return;

  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: { retrievalLockerId: true },
  });
  if (rental?.retrievalLockerId) {
    await recordCompartmentAfterCommit(
      rental.retrievalLockerId,
      door === "main_door" ? "top" : "bottom",
      { status: "AVAILABLE", rentalId: null },
    );
    await emitOccupancyForLockerId(io, rental.retrievalLockerId);
  }

  // The door is already open: a failure here must not reach the phone as an
  // error (D-108). The :15 sweep finishes any completion that fails.
  try {
    await completeAfterOwnerPickup(io, rentalId);
  } catch (err) {
    logger.error(`[D-108] completion after pickup failed for rental ${rentalId} — the sweep will retry:`, err);
  }
  logger.info(`Retrieval completed for rental ${rentalId}: door opened, item handed back to its owner`);
}

export async function completeClaim(
  io: SocketIOServer,
  rentalId: string,
  door: "main_door" | "bottom_door",
): Promise<void> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: { item: true, depositLocker: { select: { id: true } } },
  });
  if (!rental || !rental.depositLocker) {
    logger.error(`completeClaim: rental ${rentalId} missing or has no depositLocker`);
    return;
  }
  // Idempotency: MAX_OPENS allows the renter to tap "Open Kiosk Now" again
  // if the door relocks before they have the item out. Only the FIRST open
  // should commit the claim — a second tap must not re-notify the owner or
  // try to free an already-free compartment.
  if (rental.status !== "DEPOSITED") return;

  await prisma.rental.update({
    where: { id: rentalId },
    data: { status: "ACTIVE", claimedAt: new Date() },
  });

  await recordCompartmentAfterCommit(rental.depositLocker.id, door === "main_door" ? "top" : "bottom", {
    status: "AVAILABLE",
    rentalId: null,
  });
  await emitOccupancyForLockerId(io, rental.depositLocker.id);

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

  io.to(`user:${rental.ownerId}`).emit("rental:active", { rentalId });
  logger.info(`Claim completed for rental ${rentalId}: door opened, item handed off`);
}
