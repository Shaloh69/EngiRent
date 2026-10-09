import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { emitOccupancyForLockerId } from "./lockerOccupancyService";
import { compartmentHolding, setCompartment } from "./lockerCompartments";
import { hasLiveGrantOnBay } from "./kioskBayAccessStore";
import {
  decideRelease,
  hoursSince,
  isWithinReleaseWindow,
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
    await releaseInPlace(io, {
      rentalId,
      ownerId: rental.ownerId,
      itemTitle: rental.item.title,
      bay,
      where,
      releaseReason,
      why:
        where === "bottom"
          ? "item already in the lower compartment"
          : "lower compartment occupied, stroking would stack two items",
    });
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
/**
 * Mark an item released WHERE IT ALREADY IS and tell the owner to come for it.
 * No command goes to the Pi, so nothing moves and no acknowledgement will ever
 * arrive — which is why `releasedAt` is written together with
 * `releaseRequestedAt`: the item is already where the owner collects it.
 */
async function releaseInPlace(
  io: Server,
  p: {
    rentalId: string;
    ownerId: string;
    itemTitle: string;
    bay: { id: string; lockerNumber: string };
    where: "top" | "bottom";
    releaseReason: ReleaseReason;
    why: string;
  },
): Promise<void> {
  const door = p.where === "bottom" ? "bottom_door" : "main_door";
  const now = new Date();
  await prisma.rental.update({
    where: { id: p.rentalId },
    data: {
      releaseReason: p.releaseReason,
      releaseRequestedAt: now,
      retrievalLockerId: p.bay.id,
      releasedAt: now,
    },
  });
  await setCompartment(p.bay.id, p.where, {
    status: "AWAITING_RETRIEVAL",
    rentalId: p.rentalId,
  });
  await emitOccupancyForLockerId(io, p.bay.id);

  await prisma.notification.create({
    data: {
      userId: p.ownerId,
      title: "Item ready to collect",
      message: `${p.itemTitle} is ready for you at locker ${p.bay.lockerNumber}. Scan the kiosk QR to open it.`,
      type: "ITEM_READY_FOR_CLAIM",
      relatedEntityId: p.rentalId,
      relatedEntityType: "rental",
    },
  });
  io.to(`user:${p.ownerId}`).emit("rental:released", {
    rentalId: p.rentalId,
    reason: p.releaseReason,
    lockerNumber: p.bay.lockerNumber,
  });

  logger.info(
    `[E4.6] released IN PLACE for rental ${p.rentalId}, bay ${p.bay.lockerNumber} ` +
      `(${door}, no actuator stroke: ${p.why}), reason ${p.releaseReason}`,
  );
}

/**
 * E6.R / E6.S — hand an item back to its OWNER where it sits: a passed return
 * (OWNER_RETURN_PICKUP), a rejected deposit (DEPOSIT_REJECTED) or a disputed
 * return (RETURN_DISPUTED). It is never dropped here (user rulings,
 * 2026-09-24: the owner collects in person, at any hour).
 *
 * This deliberately skips `decideRelease`. Every guard in that policy protects
 * an actuator stroke: F10 keeps a drop out of an unattended compartment at
 * night, auto-release is a switch for scheduled strokes, and F2 refuses to move
 * a floor someone may have a hand on. An in-place release moves nothing, and
 * routing it through those guards is what stranded a return approved at 22:47
 * (D-107): refused by F10, never retried, then unreachable once COMPLETED.
 *
 * Finds the item in whichever bay holds it — the return bay first, then the
 * deposit bay — from the compartment columns, not the rental status, so it
 * also recovers an item already stranded that way (the admin escape hatch).
 * Idempotent: a second call on a rental already released is a no-op.
 *
 * If the owner never comes, `dropUncollectedToLower` moves it down later so
 * the upper compartment is free again.
 */
export async function releaseForOwnerPickup(
  io: Server,
  rentalId: string,
  releaseReason: ReleaseReason = "OWNER_RETURN_PICKUP",
): Promise<ReleaseOutcome> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: { select: { title: true } },
      returnLocker: LOCKER_SELECT,
      depositLocker: LOCKER_SELECT,
    },
  });
  if (!rental) return { released: false, refusal: "rental not found" };
  if (rental.releaseRequestedAt) {
    return { released: false, refusal: "already released" };
  }

  let bay: { id: string; lockerNumber: string } | null = null;
  let where: "top" | "bottom" | null = null;
  for (const candidate of [rental.returnLocker, rental.depositLocker]) {
    if (!candidate) continue;
    const found = await compartmentHolding(candidate.id, rentalId);
    if (found) {
      bay = candidate;
      where = found;
      break;
    }
  }
  if (!bay || !where) {
    logger.error(
      `[E6.R] owner pickup REFUSED for rental ${rentalId}: no bay records it in either ` +
        `compartment. Nothing released.`,
    );
    return { released: false, refusal: "item not recorded in either compartment" };
  }

  await releaseInPlace(io, {
    rentalId,
    ownerId: rental.ownerId,
    itemTitle: rental.item.title,
    bay,
    where,
    releaseReason,
    why: "the owner collects it in person where it sits (E6.R/E6.S)",
  });
  return { released: true, reason: releaseReason, lockerNumber: bay.lockerNumber };
}

/**
 * E6.S — the owner never came. Move their item from the UPPER compartment down
 * to the lower one so the upper is free for the next deposit (user ruling,
 * 2026-09-24: "only block if a locker's top and bottom are both occupied").
 *
 * DRIVES HARDWARE, unattended — so every guard an unattended stroke has always
 * had applies here: the per-kiosk grace, auto-release, F10 (07:00-21:00) and
 * F2 (no door open, no drop running, and NO live grant on the bay, including
 * this owner's own: someone holding a grant may be standing at it right now).
 * Refuses rather than strokes on anything unexpected.
 *
 * The item is in transit from the command until the Pi's ack, so `releasedAt`
 * is cleared first: the retrieve branch then fails closed ("release not
 * confirmed") instead of opening a door onto a moving floor, and the existing
 * `confirmRelease` settles both compartments on the ack exactly as it does for
 * any other drop. A lost ack surfaces through `findUnacknowledgedReleases` (F3).
 */
export async function dropUncollectedToLower(
  io: Server,
  rentalId: string,
  now: Date = new Date(),
): Promise<ReleaseOutcome> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: { select: { title: true } },
      retrievalLocker: LOCKER_SELECT,
    },
  });
  if (!rental) return { released: false, refusal: "rental not found" };
  if (!rental.releasedAt || rental.retrievedAt) {
    return { released: false, refusal: "not waiting for its owner" };
  }
  const bay = rental.retrievalLocker;
  if (!bay) return { released: false, refusal: "no retrieval bay on record" };

  const configRow = await prisma.kioskConfig.findUnique({ where: { kioskId: bay.kioskId } });
  const policy = readRetrievalPolicy(configRow?.config);

  // User ruling 2026-10-10: a DISPUTED item goes down to the lower compartment at
  // once, at any hour, so the top door is free for the next check. The grace
  // exists to give an owner time to come for a passed return; a disputed item is
  // not waiting on that, and the window exists to keep an unattended stroke out
  // of the night, which the ruling waives for this one case. Everything that
  // keeps a stroke SAFE still applies below: operational bay, auto-release not
  // switched off, no open door, no running drop, no live grant on the bay, and
  // an empty lower compartment.
  const immediate = rental.releaseReason === "RETURN_DISPUTED";
  const waited = hoursSince(rental.releasedAt, now);
  if (!immediate && waited < policy.collection_grace_hours) {
    return { released: false, refusal: `owner still within the ${policy.collection_grace_hours}h grace` };
  }
  if (!bay.isOperational || bay.status === "OUT_OF_SERVICE") {
    return { released: false, refusal: `bay ${bay.lockerNumber} is not operational` };
  }
  if (!policy.auto_release_enabled) {
    return { released: false, refusal: "automatic release is switched off for this kiosk" };
  }
  if (!immediate && !isWithinReleaseWindow(now, policy)) {
    return {
      released: false,
      refusal: `outside the release window ${policy.release_window_start_hour}:00-${policy.release_window_end_hour}:00`,
    };
  }
  if (bayBusyWith(bay.kioskId, bay.lockerNumber) || hasLiveGrantOnBay(bay.kioskId, bay.lockerNumber)) {
    return {
      released: false,
      refusal: `bay ${bay.lockerNumber} has a live session, an open door or a drop running`,
    };
  }

  const where = await compartmentHolding(bay.id, rentalId);
  if (where !== "top") {
    // Already below, or not recorded: nothing to move, and never stroke blind.
    return {
      released: false,
      refusal: where === "bottom" ? "already in the lower compartment" : "item not recorded in the bay",
    };
  }
  const bayRow = await prisma.locker.findUnique({
    where: { id: bay.id },
    select: { bottomStatus: true, bottomRentalId: true },
  });
  if (bayRow?.bottomStatus !== "AVAILABLE" || bayRow?.bottomRentalId) {
    // The lower compartment holds something else: stroking would stack two
    // students' property. The item stays up top and this bay is genuinely full.
    return { released: false, refusal: "lower compartment occupied — the item stays where it is" };
  }

  const commandId = `DROP${Date.now().toString(36).toUpperCase()}`;
  pendingDrops.set(commandId, rentalId);
  await prisma.rental.update({
    where: { id: rentalId },
    data: { releaseRequestedAt: now, releasedAt: null },
  });
  await setCompartment(bay.id, "top", { status: "AWAITING_RETRIEVAL", rentalId });
  await setCompartment(bay.id, "bottom", { status: "RESERVED", rentalId });
  await emitOccupancyForLockerId(io, bay.id);
  noteDropStarted(bay.kioskId, bay.lockerNumber, rentalId);

  // No durations are sent — the Pi reads its own hand-calibrated per-bay timings.
  io.to(`kiosk:${bay.kioskId}`).emit("kiosk:command", {
    action: "drop_item",
    command_id: commandId,
    locker_id: parseInt(bay.lockerNumber, 10),
    rental_id: rentalId,
  });

  await prisma.notification.create({
    data: {
      userId: rental.ownerId,
      title: "Item moved to the collection door",
      message: immediate
        ? `The item returned for ${rental.item.title} is under dispute and has been moved to the ` +
          `lower collection door of locker ${bay.lockerNumber}. Scan the kiosk QR to open it.`
        : `${rental.item.title} was not collected, so it has been moved to the lower ` +
          `collection door of locker ${bay.lockerNumber}. Scan the kiosk QR to open it.`,
      type: "ITEM_READY_FOR_CLAIM",
      relatedEntityId: rentalId,
      relatedEntityType: "rental",
    },
  });
  logger.info(
    `[E6.S] uncollected item of rental ${rentalId} DROPPED to the lower compartment of bay ` +
      `${bay.lockerNumber} after ${waited.toFixed(2)}h (command ${commandId})`,
  );
  return { released: true, reason: rental.releaseReason ?? undefined, lockerNumber: bay.lockerNumber };
}

/**
 * User ruling 2026-10-10 — a disputed item is released to its owner AND dropped to
 * the lower compartment straight away, whatever the hour, so the top door is free
 * for the next check and a bay is only full when both compartments are occupied.
 *
 * One entry point for the three places a return becomes DISPUTED (the admin's
 * Reject, the automatic rejection, and a student's own dispute), so none of them
 * can keep the old "leave it up top until the owner comes" behaviour.
 *
 * The in-place release comes first and stays valid on its own: if the drop is
 * refused (someone has a live session on the bay, a door is open, the lower
 * compartment is occupied, automatic release is off), the item simply remains
 * collectable where it sits, and the hourly sweep retries the drop.
 */
export async function releaseDisputedItem(io: Server, rentalId: string): Promise<ReleaseOutcome> {
  const placed = await releaseForOwnerPickup(io, rentalId, "RETURN_DISPUTED");
  if (!placed.released) return placed;
  const dropped = await dropUncollectedToLower(io, rentalId);
  if (!dropped.released) {
    logger.warn(
      `[E6.S] disputed item of rental ${rentalId} stays in the upper compartment for now: ` +
        `${dropped.refusal}. It is collectable there and the hourly sweep will retry the drop.`,
    );
    return placed;
  }
  return dropped;
}

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
