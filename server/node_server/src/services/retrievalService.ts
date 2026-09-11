import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { emitOccupancyForLockerId } from "./lockerOccupancyService";
import {
  decideRelease,
  readRetrievalPolicy,
  ReleaseCandidate,
  ReleaseDecision,
  ReleaseReason,
} from "./retrievalPolicy";

/**
 * E4.6 — the executor. Deliberately dumb.
 *
 * Every judgement about whether a 22-second actuator stroke should happen lives
 * in `retrievalPolicy.ts`, which is pure and unit-tested. This module only does
 * what it is told: read the row, ask the policy, and if the answer is yes,
 * write the request, send the command and update the bay.
 *
 * The ordering here is the safety property. `releaseRequestedAt` is written
 * BEFORE the command leaves, and `releasedAt` only when the Pi acknowledges.
 * A crash between the two leaves a row that says "asked, never confirmed",
 * which is recoverable; the reverse would leave a row claiming an item had
 * moved compartments when it had not (failure mode F3).
 */

/**
 * command_id -> rentalId, so the Pi's `kiosk:ack` can be matched back to the
 * rental whose item just moved. The ack payload carries kiosk_id/command_id/
 * action and NOT rental_id, so without this the acknowledgement is unattributable.
 *
 * In memory on purpose: a server restart loses the mapping, the ack is ignored,
 * and the row stays "requested, not confirmed" — which is precisely the state
 * F3's reconciliation exists to surface. Losing it fails safe.
 */
const pendingDrops = new Map<string, string>();

export function rentalForCommand(commandId: string): string | undefined {
  return pendingDrops.get(commandId);
}

/** Bays whose doors the kiosk currently reports open, keyed `kioskId:bay`. */
const openDoors = new Set<string>();

export function noteDoorOpen(kioskId: string, lockerNumber: string): void {
  openDoors.add(`${kioskId}:${lockerNumber}`);
}
export function noteDoorClosed(kioskId: string, lockerNumber: string): void {
  openDoors.delete(`${kioskId}:${lockerNumber}`);
}
export function isDoorOpen(kioskId: string, lockerNumber: string): boolean {
  return openDoors.has(`${kioskId}:${lockerNumber}`);
}

/** Which bay is physically holding this rental's item right now? */
function holdingLocker(rental: {
  status: string;
  depositLocker: { id: string; lockerNumber: string; status: string; isOperational: boolean; kioskId: string } | null;
  returnLocker: { id: string; lockerNumber: string; status: string; isOperational: boolean; kioskId: string } | null;
}) {
  // A return sits in the return bay; everything else sits where it was
  // deposited. Checked in this order because a rental late in its life has both.
  if (rental.status === "VERIFICATION" || rental.status === "DISPUTED") {
    return rental.returnLocker ?? rental.depositLocker;
  }
  return rental.depositLocker ?? rental.returnLocker;
}

const LOCKER_SELECT = {
  select: {
    id: true,
    lockerNumber: true,
    status: true,
    isOperational: true,
    kioskId: true,
  },
} as const;

export interface ReleaseOutcome {
  released: boolean;
  reason?: string;
  refusal?: string;
  lockerNumber?: string;
}

/**
 * Ask for an item to be dropped into the lower compartment.
 *
 * `onDemand` marks an owner standing at the kiosk asking for their own item, as
 * opposed to the scheduler proposing one. See the policy module for what that
 * does and — more importantly — what it does not relax.
 */
export async function requestRelease(
  io: Server,
  rentalId: string,
  opts: {
    onDemand?: boolean;
    hasLiveKioskSession?: boolean;
    /**
     * R4/R5 carry more meaning than the rental status can. A deposit rejected
     * by item verification and a rental the renter cancelled both end as
     * CANCELLED, and an operator needs to tell those two apart when a student
     * asks why their item was moved.
     */
    reasonOverride?: ReleaseReason;
  } = {},
): Promise<ReleaseOutcome> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: { select: { title: true } },
      depositLocker: LOCKER_SELECT,
      returnLocker: LOCKER_SELECT,
    },
  });
  if (!rental) return { released: false, refusal: "rental not found" };

  const locker = holdingLocker(rental);
  const kioskId = locker?.kioskId ?? "";

  const configRow = kioskId
    ? await prisma.kioskConfig.findUnique({ where: { kioskId } })
    : null;
  const policy = readRetrievalPolicy(configRow?.config);

  const candidate: ReleaseCandidate = {
    rentalId,
    status: rental.status,
    depositedAt: rental.depositedAt,
    releaseRequestedAt: rental.releaseRequestedAt,
    locker: locker
      ? {
          id: locker.id,
          lockerNumber: locker.lockerNumber,
          status: locker.status,
          isOperational: locker.isOperational,
        }
      : null,
    hasLiveKioskSession: opts.hasLiveKioskSession ?? false,
    hasOpenDoor: locker ? isDoorOpen(locker.kioskId, locker.lockerNumber) : false,
  };

  const decision: ReleaseDecision = decideRelease(candidate, new Date(), policy, {
    onDemand: opts.onDemand,
  });

  if (!decision.release) {
    logger.info(
      `[E4.6] release refused for rental ${rentalId}: ${decision.code} — ${decision.because}`,
    );
    return { released: false, refusal: decision.because };
  }

  const bay = locker!;
  const releaseReason = opts.reasonOverride ?? decision.reason;
  const commandId = `DROP${Date.now().toString(36).toUpperCase()}`;
  pendingDrops.set(commandId, rentalId);

  // Written BEFORE the command goes out. This is the idempotency guard the
  // policy reads on the next tick, so it has to land first even though it
  // means a refused-by-the-Pi drop leaves a row to reconcile.
  await prisma.rental.update({
    where: { id: rentalId },
    data: {
      releaseReason,
      releaseRequestedAt: new Date(),
      retrievalLockerId: bay.id,
    },
  });

  // The bay is out of service for deposits from this moment, not from the ack:
  // if the actuator is about to move, nothing else may be assigned here.
  await prisma.locker.update({
    where: { id: bay.id },
    data: { status: "AWAITING_RETRIEVAL", currentRentalId: rentalId },
  });
  await emitOccupancyForLockerId(io, bay.id);

  // No durations are sent. The Pi reads extend/retract seconds from its own
  // kiosk_config.json, which is hand-calibrated per bay (17-23s) and is the
  // only correct source — see D-72 for what happens when the server invents one.
  io.to(`kiosk:${bay.kioskId}`).emit("kiosk:command", {
    action: "drop_item",
    command_id: commandId,
    locker_id: parseInt(bay.lockerNumber, 10),
    rental_id: rentalId,
  });

  await prisma.notification.create({
    data: {
      userId: rental.ownerId,
      title: "Item ready to collect",
      message: `${rental.item.title} has been moved to the collection door of locker ${bay.lockerNumber}. Scan the kiosk QR to open it.`,
      type: "ITEM_READY_FOR_CLAIM",
      relatedEntityId: rentalId,
      relatedEntityType: "rental",
    },
  });

  io.to(`user:${rental.ownerId}`).emit("rental:released", {
    rentalId,
    reason: releaseReason,
    lockerNumber: bay.lockerNumber,
  });

  logger.info(
    `[E4.6] drop_item sent for rental ${rentalId}, bay ${bay.lockerNumber}, reason ${releaseReason}`,
  );
  return { released: true, reason: releaseReason, lockerNumber: bay.lockerNumber };
}

/**
 * The Pi acknowledged the drop. Only now is the item known to be in the lower
 * compartment, and only now may a bottom door be opened for it.
 */
export async function confirmRelease(rentalId: string): Promise<void> {
  for (const [cid, rid] of pendingDrops) if (rid === rentalId) pendingDrops.delete(cid);
  const updated = await prisma.rental.updateMany({
    where: { id: rentalId, releaseRequestedAt: { not: null }, releasedAt: null },
    data: { releasedAt: new Date() },
  });
  if (updated.count > 0) {
    logger.info(`[E4.6] release acknowledged for rental ${rentalId}`);
  }
}

/**
 * F3 — drops commanded and never acknowledged. Surfaced, never auto-retried:
 * the item may be in either compartment and a blind second stroke could push a
 * second item onto the first.
 */
export async function findUnacknowledgedReleases(staleAfterSeconds = 120) {
  const cutoff = new Date(Date.now() - staleAfterSeconds * 1000);
  return prisma.rental.findMany({
    where: { releaseRequestedAt: { not: null, lt: cutoff }, releasedAt: null },
    select: {
      id: true,
      releaseReason: true,
      releaseRequestedAt: true,
      retrievalLockerId: true,
    },
  });
}
