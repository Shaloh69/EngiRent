import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { emitOccupancyForLockerId } from "./lockerOccupancyService";
import { compartmentHolding, setCompartment } from "./lockerCompartments";
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
    // E5 — so a long-lead rental is not declared uncollected before the day
    // the renter chose. `include` above returns all Rental scalars.
    pickupDate: rental.pickupDate,
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

  // ── E5: WHERE IS THE ITEM, AND IS IT SAFE TO MOVE IT? ──────────────────
  //
  // Before E5 a bay held one item, always in the upper compartment, so a
  // release was always the same thing: one actuator stroke, upper to lower.
  // Bay reuse makes that assumption dangerous in two different ways, and both
  // were found on 2026-09-18 before the second physical test:
  //
  //  1. The item may ALREADY be in the lower compartment — a long-lead
  //     deposit dropped into storage, then never collected. Stroking the
  //     actuator would move nothing (the upper compartment is empty) while
  //     still putting a moving mechanism through a cycle for no reason. The
  //     user asked specifically that this never happen.
  //
  //  2. Far worse: the item may be in the UPPER compartment while the lower
  //     one holds SOMEONE ELSE's stored long-lead item. A same-day deposit is
  //     allowed into a bay whose lower compartment is occupied (it only needs
  //     the upper one), so if that deposit is then rejected, the old code
  //     would stroke it straight down onto the stored item. F4 did not catch
  //     it: F4 reads the whole-bay status for AWAITING_RETRIEVAL, and a stored
  //     item's compartment is OCCUPIED. That is two students' property stacked
  //     in one compartment — the single invariant this design exists to
  //     protect.
  //
  // So the release now asks the compartments, not the whole-bay status, and
  // only strokes when the item is up top AND the space below is genuinely
  // empty. In every other case the item is released IN PLACE and the owner
  // collects it through whichever door already holds it.
  const where = await compartmentHolding(bay.id, rentalId);
  const bayRow = await prisma.locker.findUnique({
    where: { id: bay.id },
    select: { bottomStatus: true, bottomRentalId: true },
  });
  const lowerIsFree =
    bayRow?.bottomStatus === "AVAILABLE" && !bayRow?.bottomRentalId;

  if (where === null) {
    // Neither compartment records this rental. Refuse rather than stroke
    // blind: a guess here moves a mechanism with property inside it.
    logger.error(
      `[E4.6] release REFUSED for rental ${rentalId}: bay ${bay.lockerNumber} holds it in ` +
        `neither compartment. No actuator command sent.`,
    );
    return { released: false, refusal: "item not recorded in either compartment" };
  }

  if (where === "bottom" || !lowerIsFree) {
    // RELEASE IN PLACE — no actuator stroke.
    const door = where === "bottom" ? "bottom_door" : "main_door";
    const now = new Date();
    await prisma.rental.update({
      where: { id: rentalId },
      data: {
        releaseReason,
        releaseRequestedAt: now,
        retrievalLockerId: bay.id,
        // Nothing was commanded, so no acknowledgement will ever arrive. The
        // item is already where the owner will collect it, which is exactly
        // what `releasedAt` asserts.
        releasedAt: now,
      },
    });
    await setCompartment(bay.id, where, {
      status: "AWAITING_RETRIEVAL",
      rentalId,
    });
    await emitOccupancyForLockerId(io, bay.id);

    await prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: "Item ready to collect",
        message: `${rental.item.title} is ready for you at locker ${bay.lockerNumber}. Scan the kiosk QR to open it.`,
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
      `[E4.6] released IN PLACE for rental ${rentalId}, bay ${bay.lockerNumber} ` +
        `(${door}, no actuator stroke: ` +
        (where === "bottom"
          ? "item already in the lower compartment"
          : "lower compartment occupied, stroking would stack two items") +
        `), reason ${releaseReason}`,
    );
    return { released: true, reason: releaseReason, lockerNumber: bay.lockerNumber };
  }

  // Item is up top and the space below is empty: the one case that strokes.
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

  // Both compartments are blocked from this moment, not from the ack: while
  // the actuator travels the item is in neither compartment cleanly, and
  // nothing may be assigned to either. `confirmRelease` settles them.
  await setCompartment(bay.id, "top", { status: "AWAITING_RETRIEVAL", rentalId });
  await setCompartment(bay.id, "bottom", { status: "RESERVED", rentalId });
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

    // E5 — the stroke is confirmed, so the compartments can now say where the
    // item really is: the upper one is empty and free for reuse, the lower one
    // holds the item for its owner. Until this ack both were blocked
    // (requestRelease), because the item was mid-travel.
    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      select: { retrievalLockerId: true },
    });
    if (rental?.retrievalLockerId) {
      await setCompartment(rental.retrievalLockerId, "top", {
        status: "AVAILABLE",
        rentalId: null,
      });
      await setCompartment(rental.retrievalLockerId, "bottom", {
        status: "AWAITING_RETRIEVAL",
        rentalId,
      });
    }
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
