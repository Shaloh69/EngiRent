import prisma from "../config/database";
import logger from "../utils/logger";
import { decryptJson, isEncryptedBlob, EncryptedBlob } from "../utils/crypto";
import { createRefund } from "../controllers/paymentController";
import { canAutoPayout, createTransfer, TransferRail } from "./payoutService";
import { envOf } from "./paymentGateway";

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

const SETTLEMENT_INCLUDE = {
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
  transactions: { where: { status: "COMPLETED" as const } },
};

function loadForSettlement(rentalId: string) {
  return prisma.rental.findUnique({ where: { id: rentalId }, include: SETTLEMENT_INCLUDE });
}
type SettlementRental = NonNullable<Awaited<ReturnType<typeof loadForSettlement>>>;

/** Concerns v2: the longest a returned renter's deposit is held for the owner's damage report. */
export const DEPOSIT_HOLD_MAX_HOURS = 72;
/** Concerns v2: once the owner has collected, they have this long to report hidden damage. */
export const DEPOSIT_HOLD_AFTER_PICKUP_HOURS = 24;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Refund the renter's deposit minus whatever has been logged against it
 * (DAMAGE_FEE / LATE_FEE / EXTENSION_FEE). Moved out of finalizeRentalCompletion
 * unchanged (2026-10-13) so a HELD deposit can be released later by the same code.
 */
async function refundDepositNet(rental: SettlementRental): Promise<void> {
  const rentalId = rental.id;
  const itemTitle = rental.item.title;
  const depositTxn = rental.transactions.find((t) => t.type === "SECURITY_DEPOSIT");
  const deductions = rental.transactions
    .filter((t) => t.type === "DAMAGE_FEE" || t.type === "LATE_FEE" || t.type === "EXTENSION_FEE")
    .reduce((sum, t) => sum + t.amount, 0);

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

    // P2: decided by HOW the deposit was paid, not by a key on this server. A
    // PayMongo deposit is refunded through its own gateway; if that fails it
    // stays owed (the catch below), never a ledger-only refund.
    if (refundAmount > 0 && depositTxn.paymongoPaymentId) {
      try {
        await createRefund({
          paymentId: depositTxn.paymongoPaymentId,
          amount: refundAmount,
          reason: "others",
          from: depositTxn,
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
      // No paymongoPaymentId: a manual (GCash, admin-confirmed) deposit, or
      // local dev — fall back to a ledger-only refund rather than blocking
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

}

/**
 * `holdDeposit` (Concerns v2, ruling 2): a passed RETURN settles the owner now but
 * HOLDS the renter's deposit until the owner has had the chance to report hidden
 * damage (see DEPOSIT_HOLD_*); `releaseHeldDeposit` refunds it later. Every other
 * caller (force-complete, dispute settlement) refunds at once, as before.
 */
export async function finalizeRentalCompletion(
  rentalId: string,
  opts: { holdDeposit?: boolean } = {},
): Promise<void> {
  const rental = await loadForSettlement(rentalId);
  if (!rental) return;

  const itemTitle = rental.item.title;
  const depositTxn = rental.transactions.find((t) => t.type === "SECURITY_DEPOSIT");
  const rentalPaymentTxn = rental.transactions.find((t) => t.type === "RENTAL_PAYMENT");
  // Renter fees (2026-10-21): the rental payment is rent + platform fee +
  // service fee; the OWNER is paid the rent only. Both fees are 0 on rentals
  // booked before then, so their payouts are unchanged.
  if (rentalPaymentTxn) {
    const fees = (rental.platformFee ?? 0) + (rental.serviceFee ?? 0);
    rentalPaymentTxn.amount = Math.max(0, round2(rentalPaymentTxn.amount - fees));
  }

  // ── 1. Renter's security deposit: held for the owner's check, or refunded now ──
  if (depositTxn && opts.holdDeposit) {
    const holdUntil = new Date(Date.now() + DEPOSIT_HOLD_MAX_HOURS * 3_600_000);
    await prisma.rental.update({ where: { id: rentalId }, data: { depositHoldUntil: holdUntil } });
    await prisma.notification.create({
      data: {
        userId: rental.renterId,
        title: "Deposit held while the owner checks the item",
        message:
          `Your ₱${depositTxn.amount.toFixed(2)} deposit for ${itemTitle} is held until the owner has checked the item: ` +
          `${DEPOSIT_HOLD_AFTER_PICKUP_HOURS} hours after they collect it, and never more than ${DEPOSIT_HOLD_MAX_HOURS / 24} days. ` +
          `If they report no damage, it is refunded automatically.`,
        type: "PAYMENT_RECEIVED",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    });
    logger.info(`[SETTLEMENT] Rental ${rentalId}: deposit ₱${depositTxn.amount} HELD until ${holdUntil.toISOString()}`);
  } else if (depositTxn) {
    await refundDepositNet(rental);
  }

  // ── 2. Owner's rental-payment payout ──────────────────────────────────────
  // Dispute v2: wrong-item fees the renter paid at the kiosk compensate the
  // owner for the time without their item, so they are paid out with the
  // rental. Never drawn from the deposit (they were paid in cash), so they are
  // not in `deductions` above. A refunded (overturned) fee is not COMPLETED.
  const disputeFees = rental.transactions
    .filter((t) => t.type === "DISPUTE_FEE")
    .reduce((sum, t) => sum + t.amount, 0);
  // Concerns v2: rent given back to the renter for a defective item comes out
  // of the owner's payout.
  const rentRefunds = rental.transactions
    .filter((t) => t.type === "RENTAL_REFUND")
    .reduce((sum, t) => sum + t.amount, 0);
  if (rentalPaymentTxn && rentRefunds > 0) {
    rentalPaymentTxn.amount = Math.max(0, round2(rentalPaymentTxn.amount - rentRefunds));
    logger.info(`[SETTLEMENT] Rental ${rentalId}: owner payout reduced by ₱${rentRefunds} rent refunded to the renter`);
  }
  if (rentalPaymentTxn && disputeFees > 0) {
    rentalPaymentTxn.amount = Math.round((rentalPaymentTxn.amount + disputeFees) * 100) / 100;
    logger.info(`[SETTLEMENT] Rental ${rentalId}: owner payout includes ₱${disputeFees} in dispute fees`);
  }
  if (rentalPaymentTxn) {
    const owner = rental.owner;
    const accountNumber = await decryptAccountNumber(owner.payoutAccountNumber);
    const payoutReady =
      owner.payoutBic && owner.payoutProvider && owner.payoutAccountName && accountNumber;

    // P2: an automatic transfer only through the gateway the rent was paid
    // in, while it is the active one and reports a wallet (payoutService
    // canAutoPayout). Otherwise staff pay it out: PENDING, never "COMPLETED".
    const paidVia = envOf(rentalPaymentTxn);
    const auto = payoutReady ? await canAutoPayout(paidVia) : false;

    if (payoutReady && auto && paidVia) {
      try {
        const transfer = await createTransfer(paidVia, {
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
      // A destination is set, but no automatic transfer is possible (manual
      // payment, MANUAL kill switch, no PayMongo wallet yet, or the rent was
      // paid through a gateway that is no longer the active one). Before P2
      // this was recorded COMPLETED "Ledger (PayMongo not configured)": money
      // shown as paid out that nobody sent.
      const testPayment = paidVia === "sandbox";
      await prisma.transaction.create({
        data: {
          rentalId,
          userId: owner.id,
          type: "OWNER_PAYOUT",
          amount: rentalPaymentTxn.amount,
          status: "PENDING",
          paymentMethod: testPayment
            ? "Rental payout (staff pay out; TEST payment: no real money was collected)"
            : "Rental payout (staff pay out)",
        },
      });
      await prisma.notification.create({
        data: {
          userId: owner.id,
          title: "Rental payout on its way",
          message: `₱${rentalPaymentTxn.amount.toFixed(2)} for ${itemTitle} will be sent to your ${owner.payoutInstitutionName ?? "payout"} account by staff.`,
          type: "PAYMENT_RECEIVED",
          relatedEntityId: rentalId,
          relatedEntityType: "rental",
        },
      });
    }
  }
}

/**
 * E6.V (user ruling 2026-09-25, D-109): a rental that failed through no fault
 * of the renter — the owner deposited the wrong item and it was rejected —
 * refunds the renter IN FULL, automatically: the rental payment and the
 * security deposit. Before this, both rejection paths cancelled the rental and
 * left the renter's money marked COMPLETED with nothing sent back.
 *
 * Same mechanism as the return refund in finalizeRentalCompletion: a PayMongo
 * refund when the payment was made through PayMongo, otherwise a ledger-only
 * refund (manual GCash payments, confirmed by an admin, have no PayMongo id).
 * Each original row becomes REFUNDED with the refund recorded on it — there is
 * no enum value for a rental-payment refund, and adding one is a production
 * migration — and the deposit also gets its DEPOSIT_REFUND row, as a return's
 * does. Idempotent: only COMPLETED rows are touched. A refund that fails
 * leaves its row COMPLETED (still owed) and tells the renter and the admins.
 */
export async function refundRenterInFull(rentalId: string, reason: string): Promise<number> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: { select: { title: true } },
      transactions: {
        where: { status: "COMPLETED", type: { in: ["RENTAL_PAYMENT", "SECURITY_DEPOSIT"] } },
      },
    },
  });
  if (!rental) return 0;

  let refunded = 0;
  for (const txn of rental.transactions) {
    if (txn.amount <= 0) continue;
    // P2: by how it was paid. A PayMongo payment whose gateway can't refund it
    // throws into the catch: still owed, renter and admins told.
    const viaPayMongo = Boolean(txn.paymongoPaymentId);
    try {
      if (viaPayMongo) {
        await createRefund({ paymentId: txn.paymongoPaymentId as string, amount: txn.amount, reason: "others", from: txn });
      }
      const details = {
        ...((txn.paymentDetails as Record<string, unknown> | null) ?? {}),
        refund: {
          reason,
          amount: txn.amount,
          at: new Date().toISOString(),
          via: viaPayMongo ? "PayMongo" : "Ledger (PayMongo not configured or manual payment)",
        },
      };
      await prisma.$transaction([
        prisma.transaction.update({
          where: { id: txn.id },
          data: { status: "REFUNDED", paymentDetails: details },
        }),
        ...(txn.type === "SECURITY_DEPOSIT"
          ? [
              prisma.transaction.create({
                data: {
                  rentalId,
                  userId: rental.renterId,
                  type: "DEPOSIT_REFUND" as const,
                  amount: txn.amount,
                  status: "COMPLETED" as const,
                  paidAt: new Date(),
                  paymentMethod: details.refund.via,
                },
              }),
            ]
          : []),
      ]);
      refunded += txn.amount;
    } catch (err) {
      logger.error(`[E6.V] refund of ${txn.type} for rental ${rentalId} failed — still owed:`, err);
      const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
      await prisma.notification.createMany({
        data: [rental.renterId, ...admins.map((a) => a.id)].map((userId) => ({
          userId,
          title: "Refund delayed",
          message: `A ₱${txn.amount.toFixed(2)} refund for ${rental.item.title} could not be processed automatically and needs an admin.`,
          type: "SYSTEM_ANNOUNCEMENT" as const,
          relatedEntityId: rentalId,
          relatedEntityType: "rental",
        })),
      });
    }
  }

  if (refunded > 0) {
    await prisma.notification.create({
      data: {
        userId: rental.renterId,
        title: "Refunded in full",
        message: `₱${refunded.toFixed(2)} for ${rental.item.title} has been refunded — ${reason}.`,
        type: "PAYMENT_RECEIVED",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    });
    logger.info(`[E6.V] renter refunded ₱${refunded} in full for rental ${rentalId} (${reason})`);
  }
  return refunded;
}

/**
 * Concerns v2: release a HELD deposit (refund it minus anything logged against
 * it). Called by the deposit sweep when the owner's window has closed with no
 * damage report open, and by a damage-case decision after its deduction. Safe to
 * repeat: a deposit already refunded is not refunded again.
 */
export async function releaseHeldDeposit(rentalId: string, why: string): Promise<boolean> {
  const rental = await loadForSettlement(rentalId);
  if (!rental) return false;
  const depositTxn = rental.transactions.find((t) => t.type === "SECURITY_DEPOSIT");
  const already = await prisma.transaction.count({ where: { rentalId, type: "DEPOSIT_REFUND" } });
  if (depositTxn && already === 0) {
    await refundDepositNet(rental);
    logger.info(`[SETTLEMENT] Rental ${rentalId}: held deposit released (${why})`);
  }
  await prisma.rental.update({ where: { id: rentalId }, data: { depositHoldUntil: null } });
  return Boolean(depositTxn && already === 0);
}
