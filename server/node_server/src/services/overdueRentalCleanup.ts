import prisma from "../config/database";
import { recomputeItemAvailability } from "./itemAvailabilityService";
import logger from "../utils/logger";

/**
 * D-91 — a rental past its due date, never resolved, is now auto-cancelled.
 *
 * Asked for after the user watched two rentals sit AWAITING_DEPOSIT for four
 * days past their own end date, never deposited, never cancelled, just
 * cluttering the queue forever. There was no automation for this case at all
 * — only two existing crons touch overdue rentals, and neither covers it:
 *   - the E4.6 sweep (index.ts, "5 * * * *") only ever looks at DEPOSITED
 *     rentals — item physically in a kiosk, never collected.
 *   - the late-fee cron ("0 1 * * *") only ever looks at ACTIVE rentals —
 *     item physically with the renter, overdue for RETURN.
 * A rental that never even got a deposit had no automation reaching it.
 */

/**
 * Mark every unsettled transaction on a rental REFUNDED.
 *
 * Deliberately does NOT call PayMongo. This is bookkeeping only — the same
 * "void, don't refund for real" pattern used for every manual rental reset
 * performed by hand earlier in this project's life (see docs/PROGRESS.md's
 * "Cancel all three and start fresh" / "Void all four" entries). It makes the
 * books say the truth — nothing is owed — and moves no real money. An
 * unattended, scheduled job is not where a genuine refund to someone's GCash
 * should be triggered with nobody looking at it first; that stays a manual,
 * human-approved step, exactly as it has been every other time this project
 * voided a rental.
 */
export async function voidRentalTransactions(rentalId: string): Promise<number> {
  const toVoid = await prisma.transaction.findMany({
    where: {
      rentalId,
      status: { in: ["COMPLETED", "PENDING", "PROCESSING"] },
    },
    select: { id: true },
  });
  for (const t of toVoid) {
    await prisma.transaction.update({
      where: { id: t.id },
      data: { status: "REFUNDED" },
    });
  }
  return toVoid.length;
}

/**
 * How long past `endDate` a rental is given before this cancels it.
 *
 * Not zero, on purpose. E4.6's own collection grace defaults to 1h — but that
 * one exists because a bay is sitting unattended in a public corridor and the
 * cost of waiting is real. This action is purely a database write with no
 * hardware and no locker at stake, so a wider grace costs nothing and
 * protects a rental someone might be mid-way through paying for right as the
 * clock turns over. 24h is a judgement call, not a measured number — easy to
 * tune later if it turns out to be wrong in either direction.
 */
const GRACE_HOURS = 24;

export interface OverdueSweepResult {
  considered: number;
  cancelled: number;
}

/**
 * Cancel PENDING/AWAITING_DEPOSIT rentals whose window closed a full grace
 * period ago, without ever reaching a deposit.
 *
 * Scope is deliberately narrow to these two statuses. Nothing is physically
 * anywhere for either — no locker holds anything, no actuator is involved —
 * so this is pure database bookkeeping: cancel, void what was paid, tell both
 * sides.
 *
 * `DEPOSITED` (the item genuinely is inside a kiosk) is a different case on
 * purpose and is NOT handled here. That one already has an automated path —
 * the E4.6 sweep in index.ts, which now also cancels the rental once ITS OWN
 * release succeeds. Folding that case into this function would mean this
 * "no hardware involved" module reaching into a decision that drives a real
 * actuator, which is exactly the kind of scope creep that turns an audited,
 * narrow function into one nobody can reason about safely.
 */
export async function cancelOverdueUndepositedRentals(): Promise<OverdueSweepResult> {
  const cutoff = new Date(Date.now() - GRACE_HOURS * 60 * 60 * 1000);

  const overdue = await prisma.rental.findMany({
    where: {
      status: { in: ["PENDING", "AWAITING_DEPOSIT"] },
      endDate: { lt: cutoff },
    },
    select: {
      id: true,
      itemId: true,
      renterId: true,
      ownerId: true,
      endDate: true,
      item: { select: { title: true } },
    },
  });

  let cancelled = 0;
  for (const rental of overdue) {
    try {
      await prisma.rental.update({
        where: { id: rental.id },
        data: { status: "CANCELLED" },
      });
      const voided = await voidRentalTransactions(rental.id);
      await recomputeItemAvailability(rental.itemId);

      const dueDate = rental.endDate.toLocaleDateString("en-PH");
      await prisma.notification.create({
        data: {
          userId: rental.renterId,
          title: "Rental Auto-Cancelled",
          message:
            `Your rental of ${rental.item.title} was automatically cancelled — the item was ` +
            `never deposited before the rental's end date (${dueDate}). Any payment made is ` +
            `marked for refund.`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: rental.id,
          relatedEntityType: "rental",
        },
      });
      await prisma.notification.create({
        data: {
          userId: rental.ownerId,
          title: "Rental Auto-Cancelled",
          message:
            `A rental request for ${rental.item.title} was automatically cancelled — it was ` +
            `never deposited before the rental's end date (${dueDate}).`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: rental.id,
          relatedEntityType: "rental",
        },
      });

      logger.info(
        `[D-91] Auto-cancelled overdue undeposited rental ${rental.id} ` +
          `(end ${dueDate}, ${voided} transaction(s) voided)`,
      );
      cancelled += 1;
    } catch (err) {
      // One rental failing must not stop the sweep from reaching the rest.
      logger.error(
        `[D-91] Failed to auto-cancel rental ${rental.id}: ${(err as Error).message}`,
      );
    }
  }

  return { considered: overdue.length, cancelled };
}
