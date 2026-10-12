import type { Server } from "socket.io";
import prisma from "../config/database";
import { requestRelease, bayBusyWith } from "./retrievalService";
import { decideStorageDrop, readRetrievalPolicy } from "./retrievalPolicy";
import { dropToStorage } from "./storageDropService";
import { releaseHeldDeposit } from "./rentalSettlementService";
import { hasLiveGrantOnBay } from "./kioskBayAccessStore";
import logger from "../utils/logger";
import { voidRentalTransactions } from "./overdueRentalCleanup";
import { recomputeItemAvailability } from "./itemAvailabilityService";

/**
 * E4.6 / R1 — deposits the renter never collected. Moved out of index.ts's
 * hourly cron unchanged (2026-09-25) so an admin can run the same sweep on
 * demand: the cron could only ever be tested by waiting for :05.
 *
 * Every guard lives in the policy: grace period, release window, bay busy,
 * bay out of service, lower compartment already full. This loop deliberately
 * knows none of them.
 */
export async function runCollectionSweep(
  io: Server,
  onlyRentalId?: string,
): Promise<{ considered: number; released: number; cancelled: number; refusals: string[] }> {
  const uncollected = await prisma.rental.findMany({
    where: {
      status: "DEPOSITED",
      releaseRequestedAt: null,
      depositedAt: { not: null },
      ...(onlyRentalId ? { id: onlyRentalId } : {}),
    },
    select: { id: true, itemId: true },
  });

  let released = 0;
  let cancelled = 0;
  const refusals: string[] = [];
  for (const rental of uncollected) {
    const outcome = await requestRelease(io, rental.id);
    if (!outcome.released) {
      refusals.push(`${rental.id}: ${outcome.refusal}`);
      continue;
    }
    released += 1;
    // D-91 — an uncollected deposit released back to its owner used to sit
    // marked DEPOSITED forever afterwards. Scoped to LATE_COLLECTION: every
    // other release reason already has its own status transition before the
    // release runs. Only R1 was the dead end.
    if (outcome.reason === "LATE_COLLECTION") {
      await prisma.rental.update({
        where: { id: rental.id },
        data: { status: "CANCELLED" },
      });
      await voidRentalTransactions(rental.id);
      await recomputeItemAvailability(rental.itemId);
      cancelled += 1;
    }
  }
  return { considered: uncollected.length, released, cancelled, refusals };
}

/**
 * Storage drop sweep (user ruling 2026-10-12). Moves a checked item from the
 * UPPER compartment to the lower one so the top door is free, in two cases:
 *   - a future-dated (long-lead) deposit whose check has passed, for a bay whose
 *     lower compartment was full when it was assigned (it waited on top);
 *   - any deposit the renter has not collected within the grace hour, whatever
 *     the pick-up date (it used to wait for the end of that day).
 * It stays the renter's rental: nothing is cancelled and nothing goes back to
 * the owner here; R1 (`runCollectionSweep`) still owns the late renter. Every
 * judgement is `decideStorageDrop`; this loop only gathers the facts.
 * DRIVES THE ACTUATOR, unattended: runs only inside the release window and never
 * on an unchecked item. Its own cron slot, clear of the other sweeps.
 */
export async function runStorageDropSweep(
  io: Server,
  now: Date = new Date(),
): Promise<{ considered: number; dropped: number; refusals: string[] }> {
  const candidates = await prisma.rental.findMany({
    where: {
      status: "DEPOSITED",
      verificationStatus: "APPROVED",
      releaseRequestedAt: null,
      depositedAt: { not: null },
      depositLockerId: { not: null },
    },
    select: { id: true, depositedAt: true, pickupDate: true, verificationStatus: true, status: true, releaseRequestedAt: true, depositLockerId: true },
  });

  let dropped = 0;
  const refusals: string[] = [];
  for (const r of candidates) {
    const bay = await prisma.locker.findUnique({ where: { id: r.depositLockerId as string } });
    if (!bay) continue;
    const configRow = await prisma.kioskConfig.findUnique({ where: { kioskId: bay.kioskId } });
    const policy = readRetrievalPolicy(configRow?.config);
    const decision = decideStorageDrop(
      {
        status: r.status,
        verificationStatus: r.verificationStatus ?? "",
        releaseRequestedAt: r.releaseRequestedAt,
        depositedAt: r.depositedAt,
        pickupDate: r.pickupDate,
        onTop: bay.topRentalId === r.id,
        lowerFree: bay.bottomStatus === "AVAILABLE" && !bay.bottomRentalId,
        isOperational: bay.isOperational,
        hasLiveKioskSession: hasLiveGrantOnBay(bay.kioskId, bay.lockerNumber),
        hasOpenDoor: bayBusyWith(bay.kioskId, bay.lockerNumber) !== undefined,
      },
      now,
      policy,
    );
    if (!decision.drop) {
      refusals.push(`${r.id}: ${decision.code}`);
      continue;
    }
    logger.info(`[STORAGE-DROP] rental ${r.id} bay ${bay.lockerNumber}: ${decision.reason}`);
    if (await dropToStorage(io, r.id)) dropped += 1;
  }
  return { considered: candidates.length, dropped, refusals };
}

/**
 * Concerns v2 (ruling 2): refund the deposits whose hold has run out. A hold
 * set at return approval ends 24 h after the owner collects, or 72 h after
 * approval at the latest; a rental with a damage report still open is skipped
 * (the case decision releases it, after its deduction).
 */
export async function runDepositHoldSweep(
  now: Date = new Date(),
): Promise<{ due: number; released: number; waitingOnCase: number }> {
  const due = await prisma.rental.findMany({
    where: { depositHoldUntil: { not: null, lte: now } },
    select: { id: true, renterId: true, item: { select: { title: true } } },
  });
  let released = 0;
  let waitingOnCase = 0;
  for (const r of due) {
    const open = await prisma.concern.count({
      where: { rentalId: r.id, kind: "DAMAGE_ON_RETURN", status: { in: ["AWAITING_RESPONSE", "UNDER_REVIEW"] } },
    });
    if (open > 0) {
      waitingOnCase += 1;
      continue;
    }
    if (await releaseHeldDeposit(r.id, "the owner's window to report damage closed")) {
      released += 1;
      const refund = await prisma.transaction.findFirst({
        where: { rentalId: r.id, type: "DEPOSIT_REFUND" },
        orderBy: { createdAt: "desc" },
        select: { amount: true },
      });
      await prisma.notification.create({
        data: {
          userId: r.renterId,
          title: "Deposit refunded",
          message:
            `The owner of ${r.item.title} reported no damage in time, so your ` +
            `₱${(refund?.amount ?? 0).toFixed(2)} deposit has been refunded.`,
          type: "PAYMENT_RECEIVED",
          relatedEntityId: r.id,
          relatedEntityType: "rental",
        },
      });
    }
  }
  return { due: due.length, released, waitingOnCase };
}
