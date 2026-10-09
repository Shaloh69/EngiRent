import prisma from "../config/database";
import logger from "../utils/logger";
import type { Server as SocketIOServer } from "socket.io";
import { sendItemReadyForClaim } from "../utils/email";
import { isLongLeadPickup } from "./pickupLaneService";
import { dropToStorage } from "./storageDropService";
import { notifyAdmins } from "./adminRoom";
import { runMlVerification } from "./mlVerificationService";
import { buildMlEvidence } from "./verificationEvidence";

/**
 * D-87b — the assisted second opinion, run in the background.
 *
 * THE PROBLEM THIS SOLVES. Item verification has one pipeline but two callers
 * with incompatible needs. At the locker a student is standing in front of an
 * open door, so the check has to finish in seconds; with that budget the heavy
 * stages (SSIM, ResNet50, OCR) get skipped, and since deep learning alone
 * carries 25% of the weight, even a *correct* item tops out around 80-81 —
 * below the 85 threshold. Measured on 2026-09-18: identical images, confidence
 * 80.7, decision PENDING. Nothing could ever be auto-approved, and the human
 * reviewing the row was shown a number produced with a quarter of the evidence
 * missing, with no way to tell.
 *
 * So the fast run stays fast and honest, and every row it sends to a human gets
 * the full pipeline re-run here with no time pressure. The student is not
 * waiting — their item is already in the locker and the rental has already
 * moved on.
 *
 * WHAT THIS DECIDES — changed by the user's ruling, 2026-09-18.
 *
 * It was written as advisory only: never touch the rental, a human decides. The
 * ruling that followed the first physical test overrides that, for a reason the
 * original design missed. Because collection is now BLOCKED until a deposit is
 * confirmed (D-87d), "advisory only" would mean every single rental waits for a
 * human — hours, for a student who needs a multimeter for today's lab. That is
 * not a safer product, it is an unusable one.
 *
 * So this queue may now GRANT approval, under strictly bounded conditions
 * (`canAutoApprove` below): the full run must have completed with every stage
 * actually run, on real evidence, scoring at or above the same threshold the
 * synchronous path uses. It can only ever move a deposit from "waiting" to
 * "approved" — it never rejects, never cancels, and never overrides a decision
 * a human has already recorded.
 *
 * Be honest about what that costs: the trust boundary now includes a background
 * job with nobody watching it. The compensations are that the bar is the same
 * 85 the live path would have applied, that a degraded run is refused outright,
 * and that every grant is logged with its score and written to the row a
 * reviewer sees.
 *
 * WHY A SERIAL QUEUE. The ML service is a single Python process. A full run can
 * occupy it for minutes, and the next student to place an item needs the fast
 * path *now*. One at a time keeps the backlog from multiplying, and
 * `DEFER_MS` puts a gap between runs so a burst of deposits does not queue
 * behind a wall of background work.
 */

interface DeepReviewJob {
  verificationId: string;
  rentalId: string | null;
  originalUrls: string[];
  kioskUrls: string[];
  attemptNumber: number;
  mlFeatures: unknown;
}

/*
 * This held a narrow `RoomEmitter` (just `to().emit()`), mirroring adminRoom,
 * because emitting to a room was all it did. E5.4 changed that: a long-lead
 * approval now commands an actuator and rebroadcasts bay occupancy, and
 * `emitOccupancyForLockerId` needs the real server. Widening the type is the
 * honest move — the alternative was an `as unknown as` cast asserting a
 * capability the narrow type did not have.
 */
const queue: DeepReviewJob[] = [];
let running = false;
let emitter: SocketIOServer | null = null;

/**
 * Breathing room between background runs, so the fast path at the locker is
 * never queued behind back-to-back full runs on a single-process ML service.
 */
const DEFER_MS = 5_000;

/** Beyond this the backlog is the problem, not the individual job. */
const MAX_QUEUE = 50;

/**
 * The bar for granting a deposit approval from the background run.
 *
 * Deliberately the SAME number as the ML service's `threshold_verified` (85.0,
 * app/config.py). This is not an independent policy knob: it is "what the live
 * check would have decided if it had been allowed to finish". Raising it here
 * without raising it there would mean the full pipeline is held to a stricter
 * standard than the fast one, which is backwards.
 */
const AUTO_APPROVE_MIN_SCORE = 85;

/**
 * Whether a finished full run may open collection on its own.
 *
 * Every clause is load-bearing:
 *  - COMPLETED        — a FAILED run carries no evidence.
 *  - not degraded     — a run that skipped stages is exactly the situation the
 *                       fast tier is already in; approving on it would defeat
 *                       the whole point of running the full pipeline.
 *  - score present    — `undefined >= 85` is false, but being explicit keeps a
 *                       future refactor from turning a missing score into 0.
 *  - >= threshold     — the same 85 the synchronous path applies.
 */
function canAutoApprove(
  status: "COMPLETED" | "FAILED",
  degraded: boolean,
  score: number | undefined,
): boolean {
  return (
    status === "COMPLETED" &&
    !degraded &&
    typeof score === "number" &&
    score >= AUTO_APPROVE_MIN_SCORE
  );
}

/**
 * Give the queue a socket server so completed reviews reach the admin console
 * live. Optional: without it the work still runs and still lands in the row,
 * the console just finds it on its next poll.
 */
export function attachDeepReviewEmitter(io: SocketIOServer): void {
  emitter = io;
}

/**
 * Queue a full-fidelity re-run for a verification that is awaiting a human.
 *
 * Fire-and-forget by design — the caller is inside a socket handler that a
 * kiosk and two phones are waiting on, and this takes minutes. It returns as
 * soon as the row is marked QUEUED.
 */
export async function queueDeepReview(job: DeepReviewJob): Promise<void> {
  if (queue.length >= MAX_QUEUE) {
    logger.error(
      `Deep review queue is full (${MAX_QUEUE}); dropping verification ${job.verificationId}. ` +
        "The ML service is not keeping up — rows stay reviewable on the fast verdict alone.",
    );
    return;
  }

  queue.push(job);

  try {
    await prisma.verification.update({
      where: { id: job.verificationId },
      data: { deepReviewStatus: "QUEUED" },
    });
  } catch (err) {
    // A failed status write must not lose the job — the run is the valuable
    // part, the status column only describes it.
    logger.warn(
      `Could not mark verification ${job.verificationId} QUEUED: ${(err as Error).message}`,
    );
  }

  logger.info(
    `Deep review queued for verification ${job.verificationId} (position ${queue.length})`,
  );

  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;

  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      await runOne(job);
      if (queue.length > 0) {
        await new Promise((r) => setTimeout(r, DEFER_MS));
      }
    }
  } finally {
    running = false;
  }
}

async function runOne(job: DeepReviewJob): Promise<void> {
  const started = Date.now();

  try {
    await prisma.verification.update({
      where: { id: job.verificationId },
      data: { deepReviewStatus: "RUNNING" },
    });
  } catch {
    // The row may have been deleted (a cancelled rental). Let the run below
    // fail on its own update rather than guessing here.
  }

  try {
    const result = await runMlVerification(
      job.originalUrls,
      job.kioskUrls,
      job.attemptNumber,
      job.mlFeatures,
      "full",
    );

    // D-18's rule applies here too: a run that could not download the
    // references produced no evidence at all. Recording it as a COMPLETED
    // review with a real-looking score would be worse than recording nothing,
    // because a reviewer would read it as a second opinion.
    if (result.unavailable) {
      await finish(job, "FAILED", {
        error: result.unavailableReason ?? "references_unavailable",
        elapsedMs: Date.now() - started,
      });
      return;
    }

    const scores = result.method_scores ?? {};
    await finish(
      job,
      "COMPLETED",
      {
        methodScores: scores,
        elapsedSeconds: result.elapsed_seconds ?? null,
        degraded: result.degraded ?? false,
        skippedStages: result.skipped_stages ?? [],
        mode: result.mode ?? "full",
        elapsedMs: Date.now() - started,
        // D-114: the full-tier run's own reasoning, next to the quick check's.
        evidence: buildMlEvidence(result),
      },
      result.confidence,
      result.decision,
    );

    const granted = canAutoApprove(
      "COMPLETED",
      result.degraded ?? false,
      result.confidence,
    );

    logger.info(
      `Deep review COMPLETE for verification ${job.verificationId}: ` +
        `${result.decision} ${result.confidence} in ${Math.round((Date.now() - started) / 1000)}s ` +
        (granted
          ? "— clears the bar, opening collection"
          : "— below the bar, waiting for a human"),
    );

    if (granted) {
      await grantDepositApproval(job, result.confidence);
    }
  } catch (err) {
    const message = (err as Error).message;
    logger.error(
      `Deep review FAILED for verification ${job.verificationId}: ${message}`,
    );
    await finish(job, "FAILED", {
      error: message,
      elapsedMs: Date.now() - started,
    });
  }
}

/**
 * Open collection on a deposit the full model has cleared.
 *
 * Scope is deliberately DEPOSITS ONLY. The ruling was about a renter being
 * blocked from collecting; a *return* verification decides whether the item
 * came back intact, which releases a security deposit — real money, and a
 * different question from "is this the right item". Returns still go to a
 * human. Widening this to returns would be a separate ruling, not an
 * extrapolation of this one.
 *
 * Re-reads the rental and refuses unless it is still genuinely waiting, so a
 * human who reviewed the row during the ~35s the full run took is never
 * overridden by a job that started before their decision.
 */
async function grantDepositApproval(
  job: DeepReviewJob,
  score: number,
): Promise<void> {
  try {
    const rental = await prisma.rental.findFirst({
      where: { depositVerificationId: job.verificationId },
      select: {
        id: true,
        status: true,
        verificationStatus: true,
        renterId: true,
        ownerId: true,
        pickupDate: true,
        item: { select: { title: true } },
      },
    });

    if (!rental) {
      // Either a return verification (not ours to decide) or the rental is
      // gone. Both are "do nothing", and neither is an error.
      return;
    }

    const pickupDate = rental.pickupDate;

    if (rental.status !== "DEPOSITED" || rental.verificationStatus !== "MANUAL_REVIEW") {
      logger.info(
        `Deep review will not auto-approve rental ${rental.id}: ` +
          `status=${rental.status} verificationStatus=${rental.verificationStatus} ` +
          `— already decided or moved on.`,
      );
      return;
    }

    await prisma.$transaction([
      prisma.rental.update({
        where: { id: rental.id },
        data: { verificationStatus: "APPROVED", verificationScore: score },
      }),
      prisma.verification.update({
        where: { id: job.verificationId },
        data: {
          status: "APPROVED",
          reviewNotes:
            `Auto-approved by the full verification run at ${score.toFixed(1)}% ` +
            `(threshold ${AUTO_APPROVE_MIN_SCORE}%, all stages ran). No human review needed.`,
        },
      }),
      prisma.notification.create({
        data: {
          userId: rental.renterId,
          title: "Item Ready for Claim",
          message: `${rental.item.title} has been confirmed and is ready for pickup.`,
          type: "ITEM_READY_FOR_CLAIM",
          relatedEntityId: rental.id,
          relatedEntityType: "rental",
        },
      }),
    ]);

    logger.info(
      `Deposit AUTO-APPROVED for rental ${rental.id} at ${score.toFixed(1)}% — collection open`,
    );

    // E5.4 — a long-lead deposit is dropped into the lower compartment now
    // that it has passed, freeing the upper bay for another hand-off. Only
    // after approval: a rejected item must stay in the upper compartment so it
    // can be released back to its owner, and a drop is not undoable.
    //
    // DRIVES AN ACTUATOR. `dropToStorage` re-checks every precondition against
    // the database and refuses rather than stroking on a stale read.
    if (isLongLeadPickup(pickupDate) && emitter) {
      const dropped = await dropToStorage(emitter, rental.id);
      if (!dropped) {
        logger.warn(
          `Rental ${rental.id} is a long-lead pick-up but its item was NOT dropped ` +
            `to storage. It stays collectable from the upper compartment — correct, ` +
            `just without the capacity saving.`,
        );
      }
    }

    // Tell both phones, so a renter already staring at the rental screen sees
    // it open up rather than having to pull to refresh.
    if (emitter) {
      for (const userId of [rental.renterId, rental.ownerId]) {
        emitter.to(`user:${userId}`).emit("deposit:confirmed", {
          rentalId: rental.id,
          confidence: score,
          confirmedBy: "full_model",
          at: new Date().toISOString(),
        });
      }
    }

    const renter = await prisma.user.findUnique({
      where: { id: rental.renterId },
      select: { email: true, firstName: true },
    });
    if (renter) {
      await sendItemReadyForClaim(renter.email, {
        firstName: renter.firstName,
        itemTitle: rental.item.title,
        rentalId: rental.id,
      });
    }
  } catch (err) {
    // A failed grant must never lose the review result already written above.
    // The row stays in MANUAL_REVIEW and a human can still act on it, which is
    // the correct fallback.
    logger.error(
      `Could not auto-approve deposit for verification ${job.verificationId}: ` +
        `${(err as Error).message}. Row remains in manual review.`,
    );
  }
}

async function finish(
  job: DeepReviewJob,
  status: "COMPLETED" | "FAILED",
  details: Record<string, unknown>,
  score?: number,
  decision?: string,
): Promise<void> {
  try {
    await prisma.verification.update({
      where: { id: job.verificationId },
      data: {
        deepReviewStatus: status,
        deepReviewAt: new Date(),
        ...(score !== undefined && { deepReviewScore: score }),
        ...(decision !== undefined && { deepReviewDecision: decision }),
        deepReviewDetails: details as never,
      },
    });
  } catch (err) {
    logger.warn(
      `Could not record deep review result for ${job.verificationId}: ${(err as Error).message}`,
    );
    return;
  }

  if (emitter) {
    notifyAdmins(emitter, "admin:deep-review", {
      verificationId: job.verificationId,
      rentalId: job.rentalId,
      status,
      score: score ?? null,
      decision: decision ?? null,
      at: new Date().toISOString(),
    });
  }
}

/** Test/diagnostic view of the backlog. */
export function deepReviewQueueDepth(): number {
  return queue.length + (running ? 1 : 0);
}
