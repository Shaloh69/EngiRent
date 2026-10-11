import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { sendRentalCompleted } from "../utils/email";
import { finalizeRentalCompletion } from "./rentalSettlementService";
import { recomputeItemAvailability } from "./itemAvailabilityService";
import { releaseForOwnerPickup } from "./retrievalService";

/**
 * E6.R — the end of a rental, in the order the user ruled on 2026-09-24:
 *
 *   return approved  → the money settles, the item is handed back to its owner
 *                      in place, and the rental STAYS in VERIFICATION
 *   owner collects   → only then is the rental COMPLETED
 *
 * Before this, approval went straight to COMPLETED and tried to DROP the item
 * into the lower compartment. At night the drop was refused (F10), nothing
 * retried it, and a COMPLETED rental can no longer be released — so the item
 * sat in the bay with its owner never told (D-107, found live at 22:47).
 *
 * "VERIFICATION + verificationStatus APPROVED + releaseRequestedAt set" is the
 * awaiting-pickup state. It needs no schema change, and every rule that keys
 * off VERIFICATION (holdingLocker(): "a return sits in the return bay") stays
 * true — because the item is still sitting in the return bay.
 */

/**
 * A return has passed — automatically (ML APPROVED at the kiosk) or by an
 * admin's manual review. Settles the money now: the renter has done their part,
 * so their deposit refund does not wait on the owner's schedule.
 */
export async function approveReturn(io: Server | undefined, rentalId: string): Promise<void> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: { item: { select: { title: true } } },
  });
  if (!rental) return;
  if (rental.status !== "VERIFICATION") {
    logger.warn(
      `[E6.R] approveReturn for rental ${rentalId} ignored: status is ${rental.status}, not VERIFICATION`,
    );
    return;
  }

  if (io) {
    const outcome = await releaseForOwnerPickup(io, rentalId);
    if (!outcome.released && outcome.refusal !== "already released") {
      // The money still settles — the return passed — but the owner cannot be
      // sent to a bay the records cannot place the item in. Loud, not silent.
      logger.error(
        `[E6.R] return of rental ${rentalId} approved but NOT released for pickup: ${outcome.refusal}`,
      );
    }
  }

  await prisma.$transaction([
    prisma.rental.update({
      where: { id: rentalId },
      data: { verificationStatus: "APPROVED" },
    }),
    prisma.notification.create({
      data: {
        userId: rental.renterId,
        title: "Return approved",
        message:
          `Your return of ${rental.item.title} has been approved. Your security deposit ` +
          `refund is being processed. The owner collects the item next.`,
        type: "VERIFICATION_SUCCESS",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    }),
  ]);

  // Real money movement — deliberately outside the transaction above: each
  // half calls PayMongo and writes its own follow-up notification. Never twice:
  // the refund half guards itself (the deposit row becomes REFUNDED), but the
  // payout half does not, so a repeated approval would pay the owner again.
  const alreadySettled = await prisma.transaction.count({
    where: { rentalId, type: { in: ["DEPOSIT_REFUND", "OWNER_PAYOUT"] } },
  });
  if (alreadySettled === 0) {
    await finalizeRentalCompletion(rentalId);
  } else {
    logger.warn(`[E6.R] rental ${rentalId} already has settlement rows — not settling again`);
  }

  // Dispute v2: the correct item came back after a case; close it and tell
  // the owner their item is back (ruling 9: only now is the owner prompted).
  const { onDisputeReturnApproved } = await import("./disputeService");
  await onDisputeReturnApproved(io, rentalId);

  io?.to(`user:${rental.renterId}`).emit("return:approved", { rentalId });
  logger.info(`[E6.R] return APPROVED for rental ${rentalId}: settled, awaiting owner pickup`);
}

/**
 * The owner has just been let in to take their item back. This is the moment
 * the rental is COMPLETED. Only a passed return completes here: a disputed or
 * cancelled rental's item is retrieved too, but its status is settled elsewhere.
 */
export async function completeAfterOwnerPickup(
  io: Server | undefined,
  rentalId: string,
): Promise<boolean> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: { select: { title: true } },
      renter: { select: { firstName: true, email: true } },
      owner: { select: { firstName: true, email: true } },
    },
  });
  if (
    !rental ||
    rental.status !== "VERIFICATION" ||
    rental.verificationStatus !== "APPROVED" ||
    rental.releaseReason !== "OWNER_RETURN_PICKUP"
  ) {
    return false;
  }

  await prisma.$transaction([
    prisma.rental.update({
      where: { id: rentalId },
      data: { status: "COMPLETED", completedAt: new Date() },
    }),
    prisma.item.update({
      where: { id: rental.itemId },
      data: { isAvailable: true, totalRentals: { increment: 1 } },
    }),
    prisma.notification.create({
      data: {
        userId: rental.renterId,
        title: "Rental Completed",
        message: `The owner has collected ${rental.item.title}. Your rental is complete — you can now leave a review.`,
        type: "VERIFICATION_SUCCESS",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    }),
    prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: "Rental Completed",
        message: `You collected ${rental.item.title}. This rental is complete.`,
        type: "VERIFICATION_SUCCESS",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    }),
  ]);
  // The transaction sets isAvailable unconditionally; this corrects it if a
  // later booking of the same item already covers today.
  await recomputeItemAvailability(rental.itemId);

  await Promise.all([
    sendRentalCompleted(rental.renter.email, {
      firstName: rental.renter.firstName,
      itemTitle: rental.item.title,
      rentalId,
    }),
    sendRentalCompleted(rental.owner.email, {
      firstName: rental.owner.firstName,
      itemTitle: rental.item.title,
      rentalId,
    }),
  ]).catch((err) => logger.error(`[E6.R] completion email failed for ${rentalId}:`, err));

  io?.to(`user:${rental.renterId}`).emit("rental:completed", { rentalId });
  io?.to(`user:${rental.ownerId}`).emit("rental:completed", { rentalId });
  logger.info(`[E6.R] rental ${rentalId} COMPLETED: owner collected the item`);
  return true;
}
