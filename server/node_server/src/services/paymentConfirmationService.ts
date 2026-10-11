import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { sendPaymentReceived } from "../utils/email";

/**
 * What happens when a payment is confirmed or fails, in ONE place.
 *
 * Before 2026-10-11 this logic lived twice: in the PayMongo webhook handler
 * (paymentController.confirmPayment) and, deliberately duplicated as "a
 * temporary testing feature", in the admin's manual approve
 * (adminController.adminDecidePayment). With PayMongo now primary for every
 * payment and confirmed by THREE routes (the webhook, the server polling
 * PayMongo itself, and the admin's manual fallback), a third copy would have
 * been the one that drifted. All three call this.
 *
 * Idempotent: the PENDING -> PROCESSING claim means a payment confirmed by the
 * poller and the webhook in the same second advances the rental once.
 */

export type ConfirmVia = "PAYMONGO_WEBHOOK" | "PAYMONGO_POLL" | "ADMIN_MANUAL" | "DEV";

export interface ConfirmOutcome {
  status: "confirmed" | "already" | "processing" | "not_found";
  transaction?: unknown;
  fullyPaid?: boolean | null;
  remainingType?: string | null;
  rentalStatus?: string | null;
}

export async function markTransactionPaid(
  io: Server | undefined,
  transactionId: string,
  opts: { via: ConfirmVia; paymentId?: string; referenceNo?: string; actorId?: string },
): Promise<ConfirmOutcome> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      rental: {
        include: {
          item: true,
          renter: { select: { email: true, firstName: true } },
        },
      },
    },
  });
  if (!transaction) return { status: "not_found" };
  if (transaction.status === "COMPLETED" || transaction.status === "REFUNDED") {
    return { status: "already", transaction };
  }

  // Accepts a FAILED row too: a manual payment the admin rejected by mistake,
  // or a checkout PayMongo reports paid after we gave up polling, is still
  // money that arrived.
  const claimed = await prisma.transaction.updateMany({
    where: { id: transactionId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) return { status: "processing" };

  const details = {
    ...((transaction.paymentDetails as Record<string, unknown> | null) ?? {}),
    confirmedVia: opts.via,
    ...(opts.actorId && { confirmedBy: opts.actorId }),
  };
  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      status: "COMPLETED",
      paidAt: new Date(),
      ...(opts.referenceNo && { paymentReferenceNo: opts.referenceNo }),
      ...(opts.paymentId && { paymongoPaymentId: opts.paymentId }),
      ...(opts.via === "ADMIN_MANUAL" && { paymentMethod: "Manual (admin confirmed)" }),
      paymentDetails: details as never,
    },
  });

  let fullyPaid: boolean | null = null;
  let remainingType: string | null = null;
  let rentalStatus: string | null = null;

  if (transaction.type === "RENTAL_PAYMENT" || transaction.type === "SECURITY_DEPOSIT") {
    // Both must be COMPLETED before the rental advances (a renter must not
    // pay only the refundable deposit and have the owner told to hand over).
    const otherType = transaction.type === "RENTAL_PAYMENT" ? "SECURITY_DEPOSIT" : "RENTAL_PAYMENT";
    const otherCompleted = await prisma.transaction.findFirst({
      where: { rentalId: transaction.rentalId, type: otherType, status: "COMPLETED" },
    });
    fullyPaid = Boolean(otherCompleted);
    remainingType = otherCompleted ? null : otherType;

    if (otherCompleted) {
      // Only a rental still waiting for payment advances. A late confirmation
      // must never pull a rental back from a later stage.
      const advanced = await prisma.rental.updateMany({
        where: { id: transaction.rentalId, status: "PENDING" },
        data: { status: "AWAITING_DEPOSIT" },
      });
      rentalStatus = advanced.count > 0 ? "AWAITING_DEPOSIT" : transaction.rental.status;
      if (advanced.count > 0) {
        await prisma.notification.create({
          data: {
            userId: transaction.rental.ownerId,
            title: "Payment Received",
            message: `Payment received for ${transaction.rental.item.title}. Please deposit the item at the kiosk.`,
            type: "PAYMENT_RECEIVED",
            relatedEntityId: transaction.rentalId,
            relatedEntityType: "rental",
          },
        });
        if (transaction.rental.renter?.email) {
          await sendPaymentReceived(transaction.rental.renter.email, {
            firstName: transaction.rental.renter.firstName,
            amount: transaction.amount,
            itemTitle: transaction.rental.item.title,
            rentalId: transaction.rentalId,
          });
        }
      }
    } else {
      await prisma.notification.create({
        data: {
          userId: transaction.userId,
          title: "Payment Received — One More Step",
          message: `Your ${transaction.type === "RENTAL_PAYMENT" ? "rental payment" : "security deposit"} for ${transaction.rental.item.title} was received. Complete the ${otherType === "RENTAL_PAYMENT" ? "rental payment" : "security deposit"} to proceed.`,
          type: "PAYMENT_RECEIVED",
          relatedEntityId: transaction.rentalId,
          relatedEntityType: "rental",
        },
      });
    }
  }

  if (transaction.type === "DISPUTE_FEE" && transaction.disputeId) {
    const { onDisputePaymentConfirmed } = await import("./disputeKioskService");
    await onDisputePaymentConfirmed(io, transaction.disputeId, transactionId, opts.via);
  }

  const payload = {
    transactionId,
    rentalId: transaction.rentalId,
    type: transaction.type,
    amount: transaction.amount,
    status: "COMPLETED",
    itemTitle: transaction.rental.item.title,
    fullyPaid,
    remainingType,
    rentalStatus,
    via: opts.via,
  };
  io?.to(`user:${transaction.userId}`).emit("payment:approved", payload);
  if (fullyPaid) io?.to(`user:${transaction.rental.ownerId}`).emit("payment:approved", payload);

  logger.info(`Payment confirmed: ${transactionId} (${transaction.type}) via ${opts.via}`);
  return { status: "confirmed", transaction: updated, fullyPaid, remainingType, rentalStatus };
}

export async function markTransactionFailed(
  io: Server | undefined,
  transactionId: string,
  opts: { via: ConfirmVia | "VISIT_TIMEOUT" | "CHECKOUT_EXPIRED"; reason?: string; actorId?: string },
): Promise<boolean> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { rental: { include: { item: { select: { title: true } } } } },
  });
  if (!transaction) return false;
  const failed = await prisma.transaction.updateMany({
    where: { id: transactionId, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "FAILED" },
  });
  if (failed.count === 0) return false;

  if (transaction.type === "DISPUTE_FEE" && transaction.disputeId) {
    const { onDisputePaymentFailed } = await import("./disputeKioskService");
    await onDisputePaymentFailed(io, transaction.disputeId, transactionId, opts.reason ?? opts.via);
  }

  io?.to(`user:${transaction.userId}`).emit("payment:rejected", {
    transactionId,
    rentalId: transaction.rentalId,
    type: transaction.type,
    amount: transaction.amount,
    status: "FAILED",
    itemTitle: transaction.rental.item.title,
    reason: opts.reason ?? null,
  });
  logger.info(`Payment FAILED: ${transactionId} (${transaction.type}) via ${opts.via}${opts.reason ? `: ${opts.reason}` : ""}`);
  return true;
}
