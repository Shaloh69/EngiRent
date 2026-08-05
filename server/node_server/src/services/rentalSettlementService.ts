import prisma from "../config/database";
import env from "../config/env";
import logger from "../utils/logger";
import { decryptJson, isEncryptedBlob, EncryptedBlob } from "../utils/crypto";
import { createRefund } from "../controllers/paymentController";
import { createTransfer, TransferRail } from "./payoutService";

// ---------------------------------------------------------------------------
// Shared "a rental just reached COMPLETED" money-movement logic — used by
// both index.ts's completeRental() (the normal AI-verified-return path) and
// adminController.ts's settleDispute() (the admin-arbitrated path), so the
// two don't duplicate (and risk diverging on) how deposits get refunded and
// owners get paid.
//
// Two independent money movements happen here, over two different PayMongo
// mechanisms:
//   1. Renter's security deposit is refunded via the *original* payment
//      (v1 /refunds, reversing depositTxn.paymongoPaymentId) — minus
//      whatever DAMAGE_FEE/LATE_FEE has already been logged against this
//      rental. This is what "damage fees draw from the held deposit" means:
//      the deposit was already collected and is sitting with PayMongo tied
//      to that specific payment; a smaller refund is the deduction.
//   2. Owner's rental-payment earnings are paid out via a *new* Disbursement
//      Transfer (v2 /batch_transfers) to whatever payout destination they
//      configured — a different recipient than whoever paid, so it can't
//      reuse the refund-the-original-payment mechanism at all.
// Each half is independent — a failure or not-yet-configured state on one
// side must not block the other from completing.
// ---------------------------------------------------------------------------

async function decryptAccountNumber(stored: unknown): Promise<string | null> {
  if (stored == null) return null;
  if (!isEncryptedBlob(stored)) return null;
  try {
    return decryptJson<string>(stored as EncryptedBlob);
  } catch (err) {
    logger.error("Failed to decrypt payoutAccountNumber:", err);
    return null;
  }
}

export async function finalizeRentalCompletion(rentalId: string): Promise<void> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: { select: { title: true } },
      renter: { select: { id: true, email: true, firstName: true } },
      owner: {
        select: {
          id: true,
          email: true,
          firstName: true,
          payoutProvider: true,
          payoutBic: true,
          payoutInstitutionName: true,
          payoutAccountName: true,
          payoutAccountNumber: true,
        },
      },
      transactions: { where: { status: "COMPLETED" } },
    },
  });
  if (!rental) return;

  const itemTitle = rental.item.title;
  const depositTxn = rental.transactions.find((t) => t.type === "SECURITY_DEPOSIT");
  const rentalPaymentTxn = rental.transactions.find((t) => t.type === "RENTAL_PAYMENT");
  const deductions = rental.transactions
    .filter((t) => t.type === "DAMAGE_FEE" || t.type === "LATE_FEE")
    .reduce((sum, t) => sum + t.amount, 0);

  // ── 1. Renter's security deposit refund (minus damage/late fees) ─────────
  if (depositTxn) {
    const refundAmount = Math.max(0, depositTxn.amount - deductions);
    const shortfall = deductions - depositTxn.amount;

    if (shortfall > 0) {
      logger.warn(
        `[SETTLEMENT] Rental ${rentalId}: damage/late fees (₱${deductions}) exceed the ` +
          `held deposit (₱${depositTxn.amount}) by ₱${shortfall} — this excess is not ` +
          `automatically collected (no top-up charge flow exists yet). Flagging for admin follow-up.`,
      );
      await prisma.notification.create({
        data: {
          userId: rental.ownerId,
          title: "Deposit Shortfall — Manual Follow-up Needed",
          message: `Damage/late fees for ${itemTitle} (₱${deductions.toFixed(2)}) exceeded the renter's held deposit (₱${depositTxn.amount.toFixed(2)}) by ₱${shortfall.toFixed(2)}. This shortfall was not automatically collected.`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: rentalId,
          relatedEntityType: "rental",
        },
      });
    }

    if (refundAmount > 0 && env.PAYMONGO_SECRET_KEY && depositTxn.paymongoPaymentId) {
      try {
        await createRefund({
          paymentId: depositTxn.paymongoPaymentId,
          amount: refundAmount,
          reason: "others",
        });
        await prisma.$transaction([
          prisma.transaction.create({
            data: {
              rentalId,
              userId: rental.renterId,
              type: "DEPOSIT_REFUND",
              amount: refundAmount,
              status: "COMPLETED",
              paidAt: new Date(),
              paymentMethod: "PayMongo",
            },
          }),
          prisma.transaction.update({
            where: { id: depositTxn.id },
            data: { status: "REFUNDED" },
          }),
        ]);
        await prisma.notification.create({
          data: {
            userId: rental.renterId,
            title: "Security Deposit Refunded",
            message: `₱${refundAmount.toFixed(2)} of your security deposit for ${itemTitle} has been refunded.${deductions > 0 ? ` ₱${deductions.toFixed(2)} was withheld for damage/late fees.` : ""}`,
            type: "PAYMENT_RECEIVED",
            relatedEntityId: rentalId,
            relatedEntityType: "rental",
          },
        });
      } catch (err) {
        logger.error(`[SETTLEMENT] Deposit refund failed for rental ${rentalId}:`, err);
        await prisma.notification.create({
          data: {
            userId: rental.renterId,
            title: "Deposit Refund Delayed",
            message: `Your security deposit refund for ${itemTitle} could not be processed automatically. Support has been notified.`,
            type: "SYSTEM_ANNOUNCEMENT",
            relatedEntityId: rentalId,
            relatedEntityType: "rental",
          },
        });
      }
    } else if (refundAmount > 0) {
      // PayMongo not configured (local dev/demo) or no paymongoPaymentId on
      // record — fall back to a ledger-only refund rather than blocking
      // rental completion entirely, mirroring createPayment's existing
      // mock-checkout-when-unconfigured pattern.
      await prisma.$transaction([
        prisma.transaction.create({
          data: {
            rentalId,
            userId: rental.renterId,
            type: "DEPOSIT_REFUND",
            amount: refundAmount,
            status: "COMPLETED",
            paidAt: new Date(),
            paymentMethod: "Ledger (PayMongo not configured)",
          },
        }),
        prisma.transaction.update({
          where: { id: depositTxn.id },
          data: { status: "REFUNDED" },
        }),
      ]);
    }
  }

  // ── 2. Owner's rental-payment payout ──────────────────────────────────────
  if (rentalPaymentTxn) {
    const owner = rental.owner;
    const accountNumber = await decryptAccountNumber(owner.payoutAccountNumber);
    const payoutReady =
      owner.payoutBic && owner.payoutProvider && owner.payoutAccountName && accountNumber;

    if (payoutReady && env.PAYMONGO_SECRET_KEY) {
      try {
        const transfer = await createTransfer({
          amount: rentalPaymentTxn.amount,
          provider: owner.payoutProvider as TransferRail,
          purpose: "Rental payout",
          referenceNumber: rentalId,
          destinationAccountNumber: accountNumber as string,
          destinationAccountName: owner.payoutAccountName as string,
          destinationBic: owner.payoutBic as string,
        });
        await prisma.transaction.create({
          data: {
            rentalId,
            userId: owner.id,
            type: "OWNER_PAYOUT",
            amount: rentalPaymentTxn.amount,
            status: transfer.status === "failed" ? "FAILED" : "COMPLETED",
            paidAt: new Date(),
            paymentMethod: "PayMongo Disbursement",
            paymentDetails: { transferId: transfer.transferId, providerStatus: transfer.status },
          },
        });
        await prisma.notification.create({
          data: {
            userId: owner.id,
            title: "Rental Payout Sent",
            message: `₱${rentalPaymentTxn.amount.toFixed(2)} for ${itemTitle} has been sent to your ${owner.payoutInstitutionName ?? "payout"} account.`,
            type: "PAYMENT_RECEIVED",
            relatedEntityId: rentalId,
            relatedEntityType: "rental",
          },
        });
      } catch (err) {
        logger.error(`[SETTLEMENT] Owner payout failed for rental ${rentalId}:`, err);
        await prisma.transaction.create({
          data: {
            rentalId,
            userId: owner.id,
            type: "OWNER_PAYOUT",
            amount: rentalPaymentTxn.amount,
            status: "FAILED",
            paymentMethod: "PayMongo Disbursement",
          },
        });
        await prisma.notification.create({
          data: {
            userId: owner.id,
            title: "Rental Payout Failed",
            message: `Your payout of ₱${rentalPaymentTxn.amount.toFixed(2)} for ${itemTitle} could not be sent. Support has been notified.`,
            type: "SYSTEM_ANNOUNCEMENT",
            relatedEntityId: rentalId,
            relatedEntityType: "rental",
          },
        });
      }
    } else if (!payoutReady) {
      // Owner hasn't configured a payout destination yet — don't fail rental
      // completion over it; log the earning as PENDING so it's visible and
      // can be paid out retroactively once they configure one.
      await prisma.transaction.create({
        data: {
          rentalId,
          userId: owner.id,
          type: "OWNER_PAYOUT",
          amount: rentalPaymentTxn.amount,
          status: "PENDING",
          paymentMethod: "PayMongo Disbursement",
        },
      });
      await prisma.notification.create({
        data: {
          userId: owner.id,
          title: "Payout Pending — Set Up Your Payout Details",
          message: `₱${rentalPaymentTxn.amount.toFixed(2)} for ${itemTitle} is ready to send, but you haven't set up a payout destination yet. Add one in your profile to receive it.`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: rentalId,
          relatedEntityType: "rental",
        },
      });
    } else {
      // payoutReady but PAYMONGO_SECRET_KEY unset (local dev/demo).
      await prisma.transaction.create({
        data: {
          rentalId,
          userId: owner.id,
          type: "OWNER_PAYOUT",
          amount: rentalPaymentTxn.amount,
          status: "COMPLETED",
          paidAt: new Date(),
          paymentMethod: "Ledger (PayMongo not configured)",
        },
      });
    }
  }
}
