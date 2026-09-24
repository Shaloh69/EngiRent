import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { emitOccupancyForLockerId } from "./lockerOccupancyService";
import { compartmentHolding, setCompartment } from "./lockerCompartments";
import { hasLiveGrantOnBay } from "./kioskBayAccessStore";
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

/**
 * WHAT EACH BAY IS DOING RIGHT NOW — the server's half of §12's exclusivity
 * rule (D-96).
 *
 * This replaces a `Set` of open doors that **nothing ever wrote to**: both
 * `noteDoorOpen` and `noteDoorClosed` were exported and never called, so F2 —
 * `retrievalPolicy`'s "a hand may be inside" guard — could never fire in
 * production, while its unit tests passed by handing the flag in directly.
 *
 * **Every record carries its own expiry, and that is not a detail.** The
 * record is cleared by an acknowledgement from the Pi, and an acknowledgement
 * is exactly the thing that fails to arrive when something has gone wrong
 * (failure mode F3). Without a deadline, one lost ack would mark a bay busy
 * until the API restarted — a bay bricked by bookkeeping. Expiry is evaluated
 * lazily on read, so it needs no timer and survives being read after a long
 * idle.
 *
 * **The kiosk's own per-bay lock is still the guard that must be right** —
 * the Pi is the only place that knows when a stroke has genuinely finished.
 * This exists so the server stops *proposing* work it should know better than
 * to propose, and so the two sides disagree loudly instead of the Pi silently
 * absorbing commands that should never have been sent.
 */
type BayActivity = {
  /** `door_open` — a solenoid is held open and a hand may be inside.
   *  `drop` — the actuator is mid-travel; the floor of the compartment is
   *  moving. */
  kind: "door_open" | "drop";
  rentalId: string;
  since: number;
  expiresAt: number;
};

const bayActivity = new Map<string, BayActivity>();

const bayKey = (kioskId: string, lockerNumber: string) => `${kioskId}:${lockerNumber}`;

/** Margin on top of a command's real duration before the record self-clears.
 *  Generous: clearing early would re-open the guard while hardware is still
 *  moving, which is the failure this whole module exists to prevent. */
const ACTIVITY_MARGIN_MS = 20_000;

/** A drop is 34-46s of travel depending on the bay. Used only when the caller
 *  has no better number; the Pi owns the real calibration. */
const DROP_FALLBACK_MS = 60_000;

export function bayBusyWith(
  kioskId: string,
  lockerNumber: string,
): BayActivity | undefined {
  const key = bayKey(kioskId, lockerNumber);
  const activity = bayActivity.get(key);
  if (!activity) return undefined;
  if (Date.now() >= activity.expiresAt) {
    // Lazily reaped. Logged because a record that expires instead of being
    // acknowledged means an ack never came back — worth being able to find.
    bayActivity.delete(key);
    logger.warn(
      `[D-96] bay ${lockerNumber} activity '${activity.kind}' for rental ${activity.rentalId} ` +
        `expired without an acknowledgement after ${Math.round((Date.now() - activity.since) / 1000)}s — ` +
        `releasing the bay so it cannot be stuck busy`,
    );
    return undefined;
  }
  return activity;
}

export function noteDoorOpen(
  kioskId: string,
  lockerNumber: string,
  rentalId: string,
  holdSeconds: number,
): void {
  bayActivity.set(bayKey(kioskId, lockerNumber), {
    kind: "door_open",
    rentalId,
    since: Date.now(),
    expiresAt: Date.now() + holdSeconds * 1000 + ACTIVITY_MARGIN_MS,
  });
}

export function noteDoorClosed(kioskId: string, lockerNumber: string): void {
  const key = bayKey(kioskId, lockerNumber);
  if (bayActivity.get(key)?.kind === "door_open") bayActivity.delete(key);
}

export function noteDropStarted(
  kioskId: string,
  lockerNumber: string,
  rentalId: string,
): void {
  bayActivity.set(bayKey(kioskId, lockerNumber), {
    kind: "drop",
    rentalId,
    since: Date.now(),
    expiresAt: Date.now() + DROP_FALLBACK_MS + ACTIVITY_MARGIN_MS,
  });
}

export function noteDropFinished(kioskId: string, lockerNumber: string): void {
  const key = bayKey(kioskId, lockerNumber);
  if (bayActivity.get(key)?.kind === "drop") bayActivity.delete(key);
}

/** F2's `hasOpenDoor` input. A door standing open is the strongest evidence
 *  there is that a hand may be inside the bay. */
export function isDoorOpen(kioskId: string, lockerNumber: string): boolean {
  return bayBusyWith(kioskId, lockerNumber)?.kind === "door_open";
}

/** Test seam only — the map is process-local and otherwise self-expiring. */
export function __resetBayActivity(): void {
  bayActivity.clear();
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
    // D-96 — both of F2's inputs are now actually fed. `?? false` used to be
    // the whole story on the first of these, and nothing ever called the
    // writer behind the second, so the guard could not fire in production.
    hasLiveKioskSession:
      opts.hasLiveKioskSession ??
      (locker ? hasLiveGrantOnBay(locker.kioskId, locker.lockerNumber, rentalId) : false),
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

  // D-96 — the bay is busy from here until the Pi acknowledges. The
  // compartment rows above already say "do not assign anything here"; this
  // says the stronger thing, "do not COMMAND anything here", which is what
  // stops `openBay` unlocking a door onto a floor that is mid-travel. Cleared
  // in `confirmRelease`, and self-expiring if that ack never comes.
  noteDropStarted(bay.kioskId, bay.lockerNumber, rentalId);

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
      select: {
        retrievalLockerId: true,
        retrievalLocker: { select: { kioskId: true, lockerNumber: true } },
      },
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
    // D-96 — the actuator has stopped. The bay is commandable again.
    if (rental?.retrievalLocker) {
      noteDropFinished(rental.retrievalLocker.kioskId, rental.retrievalLocker.lockerNumber);
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
