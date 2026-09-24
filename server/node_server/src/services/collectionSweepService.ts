import type { Server } from "socket.io";
import prisma from "../config/database";
import { requestRelease } from "./retrievalService";
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
