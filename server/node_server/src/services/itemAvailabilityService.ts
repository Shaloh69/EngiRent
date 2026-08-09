import prisma from "../config/database";

/**
 * Checklist Stage 6 — date-based availability. Before this, `Item.isAvailable`
 * was a single boolean the system flipped false on booking and true on
 * completion: an item could be rented by exactly one person, ever, even for
 * a future week that would never actually conflict with the current rental.
 * This is the shared logic both the booking gate and the display flag use,
 * so the two definitions of "overlap" can never drift apart from each other.
 */

// Every status that means "this item is genuinely committed for its dates" —
// kept as one list so a status added to one check and forgotten in the other
// can't happen. CANCELLED/COMPLETED/DISPUTED don't block: a disputed rental
// is already over the original date range by the time it's disputed (that
// happens at return-verification, after the rental period), and blocking new
// bookings on a resolved-but-disputed rental would leave the item stuck.
export const BLOCKING_RENTAL_STATUSES = [
  "PENDING",
  "AWAITING_DEPOSIT",
  "DEPOSITED",
  "ACTIVE",
  "VERIFICATION",
] as const;

/** Every blocking rental for an item whose date range overlaps [start, end).
 * Half-open interval overlap test: two ranges overlap iff each starts before
 * the other ends. */
export async function findOverlappingRentals(
  itemId: string,
  start: Date,
  end: Date,
  excludeRentalId?: string,
) {
  return prisma.rental.findMany({
    where: {
      itemId,
      status: { in: [...BLOCKING_RENTAL_STATUSES] },
      ...(excludeRentalId ? { id: { not: excludeRentalId } } : {}),
      startDate: { lt: end },
      endDate: { gt: start },
    },
    select: { id: true, startDate: true, endDate: true, status: true },
    orderBy: { startDate: "asc" },
  });
}

/**
 * Recomputes `Item.isAvailable` as "is this item free to be picked up
 * starting right now" — true unless some blocking rental's date range
 * covers this instant. This is a display convenience for browse/My
 * Listings, not the booking gate itself (createRental checks a specific
 * requested range via findOverlappingRentals, not this).
 *
 * Deliberately called *after* the transaction that changes a rental's
 * status, not from inside it: `isAvailable` is not a financial or security
 * value, so a brief window of staleness between a transaction committing
 * and this correcting it is an acceptable trade for not touching the
 * existing payment/verification transactions themselves to add this.
 */
export async function recomputeItemAvailability(itemId: string): Promise<void> {
  const now = new Date();
  const blocking = await prisma.rental.findFirst({
    where: {
      itemId,
      status: { in: [...BLOCKING_RENTAL_STATUSES] },
      startDate: { lte: now },
      endDate: { gte: now },
    },
    select: { id: true },
  });
  await prisma.item.update({
    where: { id: itemId },
    data: { isAvailable: !blocking },
  });
}
