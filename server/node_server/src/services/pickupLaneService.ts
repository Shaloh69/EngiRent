import type { LockerStatus } from "@prisma/client";

/**
 * E5 — pick-up date, verification lanes, and bay reuse.
 *
 * One module owns the two questions the whole feature turns on:
 *   1. is this rental a long-lead pick-up?
 *   2. given two compartments, what is this bay's whole-bay status?
 *
 * They live together and are pure, because both get asked from several places
 * (the deposit handler, the background review queue, locker assignment, the
 * claim path) and a second definition drifting from the first is exactly how
 * "the fast lane ran on an item that should have had the full check" becomes
 * possible. Same reasoning as `BLOCKING_RENTAL_STATUSES` in
 * itemAvailabilityService: one list, so two checks cannot disagree.
 */

/**
 * "Above one day" resolved to a definition, because the spec flagged it as
 * undecided and code cannot be vague.
 *
 * A pick-up is LONG-LEAD when its calendar date is not today. Not "more than
 * 24 hours away": a deposit at 23:00 for an 08:00 pick-up is nine hours out
 * but is unambiguously "tomorrow" to the student who booked it, and the user's
 * own phrasing was "If the pick up date is Today". Erring toward long-lead is
 * also the safe direction — it buys the full check and frees the upper bay.
 *
 * A NULL pickupDate reads as today. Every rental created before E5 has none,
 * and those must keep taking exactly the path they took yesterday; a null that
 * silently meant "long lead" would reroute live rentals through an actuator.
 */
export function isLongLeadPickup(
  pickupDate: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!pickupDate) return false;
  return startOfLocalDay(pickupDate).getTime() > startOfLocalDay(now).getTime();
}

/**
 * Midnight local to the SERVER, which is the same machine and timezone the
 * kiosk bank sits in. Deliberately not UTC: comparing UTC days would make
 * "today" flip at 08:00 local in the Philippines (UTC+8), so a morning
 * deposit for a same-day afternoon pick-up would be classed as long-lead and
 * dropped into storage the student could not reach.
 */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Which verification lane a deposit takes. */
export type VerificationLane = "fast" | "full";

/**
 * Long-lead deposits skip the fast lane entirely.
 *
 * Not an optimisation — a correctness choice. The fast lane exists purely
 * because someone is standing at an open door, and it pays for that by
 * skipping stages worth 40% of the score, which is why it structurally cannot
 * approve anything (D-87b). For a pick-up that is days away nobody is waiting,
 * so spending the extra ~30s buys a verdict that can actually say yes.
 */
export function laneForDeposit(
  pickupDate: Date | null | undefined,
  now: Date = new Date(),
): VerificationLane {
  return isLongLeadPickup(pickupDate, now) ? "full" : "fast";
}

/** The per-compartment state this module reasons about. */
export interface CompartmentState {
  topStatus: LockerStatus;
  bottomStatus: LockerStatus;
  isOperational: boolean;
}

/** A compartment counts as free only when it is genuinely empty. */
function isFree(status: LockerStatus): boolean {
  return status === "AVAILABLE";
}

/**
 * Can a NEW hand-off be assigned to this bay's upper compartment?
 *
 * Both halves matter, and the second is the one that is easy to miss:
 *
 *  - the upper compartment must be free, obviously; and
 *  - **for a long-lead deposit, the lower compartment must also be free**,
 *    because that deposit is going to be dropped down there once its full
 *    check passes. Assigning one to a bay whose lower compartment is already
 *    occupied creates an item with nowhere to go — it would either stack on
 *    someone else's property (the invariant this design exists to protect) or
 *    sit in the upper bay forever, defeating the point.
 *
 * A same-day deposit does not need a lower slot: it is collected from the
 * upper compartment and never dropped.
 */
export function canAcceptDeposit(
  bay: CompartmentState,
  longLead: boolean,
): boolean {
  if (!bay.isOperational) return false;
  if (!isFree(bay.topStatus)) return false;
  if (longLead && !isFree(bay.bottomStatus)) return false;
  return true;
}

/**
 * Which bay takes a NEW deposit or return (user ruling 2026-10-12: use every
 * free compartment before saying "no locker").
 *
 * A new hand-off always goes into the UPPER compartment. For a long-lead
 * deposit the best bay is one whose lower compartment is free too, so the item
 * can be dropped once its check passes. When no bay has both free, a long-lead
 * deposit takes a bay with only the upper free and waits on top (the storage
 * sweep drops it when the lower compartment frees, or after the grace hour);
 * it is refused only when no bay has a free upper compartment at all.
 */
export function pickBayForDeposit<T extends CompartmentState>(
  bays: T[],
  longLead: boolean,
): { bay: T; waitsOnTop: boolean } | null {
  const best = bays.find((b) => canAcceptDeposit(b, longLead));
  if (best) return { bay: best, waitsOnTop: false };
  if (!longLead) return null;
  const upperOnly = bays.find((b) => canAcceptDeposit(b, false));
  return upperOnly ? { bay: upperOnly, waitsOnTop: true } : null;
}

/** A bay with both compartments in use can take nothing more. */
export function isFullyOccupied(bay: CompartmentState): boolean {
  return !isFree(bay.topStatus) && !isFree(bay.bottomStatus);
}

/**
 * The single whole-bay `status` that the occupancy broadcast, the kiosk
 * display and the admin console all still read.
 *
 * Kept deliberately, rather than migrating every consumer in this step: the
 * kiosk logs one status per bay (`Occupancy updated: {"1": "AVAILABLE", ...}`)
 * and the console renders the same shape. Surfacing two compartments there is
 * E5.8; until then this collapses the truth into the old vocabulary without
 * ever reporting a bay as emptier than it is.
 *
 * Order of precedence is chosen so the most restrictive true statement wins:
 *  1. not operational          -> OUT_OF_SERVICE
 *  2. both compartments in use -> OCCUPIED (the "locked" case: nothing fits)
 *  3. either compartment is awaiting retrieval -> AWAITING_RETRIEVAL, because
 *     a person is owed an item out of this bay and that must stay visible
 *  4. upper in use             -> whatever the upper says (RESERVED/OCCUPIED)
 *  5. lower in use, upper free -> OCCUPIED. Reusable by assignment, but NOT
 *     advertised as AVAILABLE: it still physically holds someone's property,
 *     and a maintenance view calling it empty is how an item gets lost.
 */
export function deriveLockerStatus(bay: CompartmentState): LockerStatus {
  if (!bay.isOperational) return "OUT_OF_SERVICE";
  if (bay.topStatus === "MAINTENANCE" || bay.bottomStatus === "MAINTENANCE") {
    return "MAINTENANCE";
  }
  if (
    bay.topStatus === "AWAITING_RETRIEVAL" ||
    bay.bottomStatus === "AWAITING_RETRIEVAL"
  ) {
    return "AWAITING_RETRIEVAL";
  }
  if (!isFree(bay.topStatus)) return bay.topStatus;
  if (!isFree(bay.bottomStatus)) return "OCCUPIED";
  return "AVAILABLE";
}

/**
 * Which door holds a given rental's item, for the claim path.
 *
 * The claim flow hardcoded `main_door`, which was right while an item could
 * only ever be in the upper compartment. Once long-lead items are dropped to
 * storage, opening the upper door for them grants access to an empty space
 * while the item sits behind the other one.
 */
export function doorHoldingRental(
  bay: { topRentalId: string | null; bottomRentalId: string | null },
  rentalId: string,
): "main_door" | "bottom_door" | null {
  if (bay.topRentalId === rentalId) return "main_door";
  if (bay.bottomRentalId === rentalId) return "bottom_door";
  return null;
}
