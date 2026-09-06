import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from "../utils/errors";
import logger from "../utils/logger";
import env from "../config/env";
import crypto from "crypto";
import axios from "axios";
import { listReceivingInstitutions } from "../services/payoutService";

// ---------------------------------------------------------------------------
// PayMongo helpers
// ---------------------------------------------------------------------------

const PAYMONGO_BASE = "https://api.paymongo.com/v1";

function paymongoAuth(): string {
  const key = env.PAYMONGO_SECRET_KEY ?? "";
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function createCheckoutSession(params: {
  amount: number; // in PHP (will be converted to centavos)
  description: string;
  rentalId: string;
  transactionId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ checkoutUrl: string; checkoutId: string }> {
  const { data } = await axios.post(
    `${PAYMONGO_BASE}/checkout_sessions`,
    {
      data: {
        attributes: {
          billing: { name: "EngiRent Hub Student" },
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          line_items: [
            {
              currency: "PHP",
              amount: Math.round(params.amount * 100), // centavos
              description: params.description,
              name: "EngiRent Rental",
              quantity: 1,
            },
          ],
          payment_method_types: ["gcash", "paymaya", "card", "brankas_bdo"],
          description: params.description,
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          metadata: {
            rental_id: params.rentalId,
            transaction_id: params.transactionId,
          },
        },
      },
    },
    {
      headers: {
        Authorization: paymongoAuth(),
        "Content-Type": "application/json",
      },
    },
  );

  return {
    checkoutUrl: data.data.attributes.checkout_url as string,
    checkoutId: data.data.id as string,
  };
}

export async function createRefund(params: {
  paymentId: string;
  amount: number; // PHP
  reason: string;
}): Promise<string> {
  const { data } = await axios.post(
    `${PAYMONGO_BASE}/refunds`,
    {
      data: {
        attributes: {
          amount: Math.round(params.amount * 100),
          payment_id: params.paymentId,
          reason: params.reason,
          notes: "EngiRent Hub automated refund",
        },
      },
    },
    {
      headers: {
        Authorization: paymongoAuth(),
        "Content-Type": "application/json",
      },
    },
  );
  return data.data.id as string;
}

// ---------------------------------------------------------------------------
// Payout-destination lookup (Disbursements)
// ---------------------------------------------------------------------------

/**
 * GET /payments/receiving-institutions?provider=instapay|pesonet
 *
 * Lists the real banks/e-wallets PayMongo can Transfer to over a given rail —
 * the Flutter app uses this to populate the payout-destination picker rather
 * than the client (or this codebase) hardcoding provider codes, which were
 * never confirmed against a live PayMongo response (see payoutService.ts).
 */
export const getReceivingInstitutions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const provider = req.query.provider as string;
    if (!["instapay", "pesonet"].includes(provider)) {
      throw new ValidationError("provider must be 'instapay' or 'pesonet'");
    }
    if (!env.PAYMONGO_SECRET_KEY) {
      res.json({ success: true, data: { institutions: [] } });
      return;
    }

    const institutions = await listReceivingInstitutions(
      provider as "instapay" | "pesonet",
    );
    res.json({ success: true, data: { institutions } });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
): boolean {
  const secret = env.PAYMONGO_WEBHOOK_SECRET;
  // Fail closed: an unconfigured secret means we cannot verify the request,
  // so it must be rejected, not waved through. (Previously returned `true`
  // here, meaning an unset secret silently disabled signature checking.)
  if (!secret) return false;

  // PayMongo signature format: "t=<ts>,te=<hash>,li=<hash>"
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("=")),
  );
  const timestamp = parts["t"];
  const expectedHash = parts["te"] ?? parts["li"];
  if (!timestamp || !expectedHash) return false;

  const message = `${timestamp}.${rawBody}`;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  const computedBuf = Buffer.from(computed);
  const expectedBuf = Buffer.from(expectedHash);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false — a malformed/tampered header must still cleanly reject (400),
  // not crash to a 500 via next(error).
  if (computedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(computedBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

// Types a renter may proactively initiate a payment for through this endpoint.
// LATE_FEE, DAMAGE_FEE, and DEPOSIT_REFUND are system/admin-created (cron,
// settleDispute, completeRental) — never client-initiated — so they're
// deliberately excluded here even though they're valid TransactionType values.
const PAYABLE_TYPES = new Set(["RENTAL_PAYMENT", "SECURITY_DEPOSIT"]);

export const createPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const { rentalId, type } = req.body;

    if (!PAYABLE_TYPES.has(type)) {
      throw new ValidationError(
        "Only RENTAL_PAYMENT or SECURITY_DEPOSIT can be initiated directly",
      );
    }

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true },
    });

    if (!rental) throw new NotFoundError("Rental not found");
    if (rental.renterId !== req.user.userId)
      throw new ForbiddenError(
        "You can only make payments for your own rentals",
      );

    // The amount is derived entirely server-side from the rental record —
    // a client-supplied amount is never trusted for anything that moves
    // money. (Previously `amount` came straight from req.body; a renter
    // could pay ₱1 for a ₱5,000 rental.)
    const parsedAmount =
      type === "RENTAL_PAYMENT"
        ? Number(rental.totalPrice)
        : Number(rental.securityDeposit);

    if (!(parsedAmount > 0)) {
      throw new ValidationError(
        `Rental has no positive ${type === "RENTAL_PAYMENT" ? "totalPrice" : "securityDeposit"} to charge`,
      );
    }

    // A rental has at most one live payment of each type. Before the payments
    // ruling a duplicate row was an abandoned PayMongo checkout session and
    // therefore harmless; under manual payments the admin console lists every
    // PENDING transaction with its own approve button, so two rows for one
    // rental are two separately approvable charges against one debt.
    const existing = await prisma.transaction.findFirst({
      where: {
        rentalId,
        type,
        status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing?.status === "COMPLETED") {
      throw new ConflictError(
        `This rental's ${type === "RENTAL_PAYMENT" ? "rental payment" : "security deposit"} has already been paid`,
      );
    }

    const manualMode = env.PAYMENT_MODE === "MANUAL";

    const transaction =
      existing ??
      (await prisma.transaction.create({
        data: {
          rentalId,
          userId: req.user.userId,
          type,
          amount: parsedAmount,
          status: "PENDING",
          // Naming the real rail matters in the ledger: an admin reconciling
          // a GCash inbox against a row labelled "PayMongo" has to know to
          // disbelieve the label.
          paymentMethod: manualMode ? "Manual" : "PayMongo",
        },
      }));

    // ── Manual mode (the live configuration) ──────────────────────────────
    // No checkout session, no redirect, no WebView. The renter is told what
    // to send and where; an admin confirms receipt through
    // POST /admin/transactions/:transactionId/decide-payment.
    if (manualMode) {
      logger.info(
        `Payment awaiting manual confirmation: ${transaction.id} for rental ${rentalId}`,
      );

      res.status(201).json({
        success: true,
        message: "Payment recorded — awaiting confirmation",
        data: {
          transaction,
          // Explicitly null rather than absent. The phone distinguishes
          // "no checkout, by design" from "the field is missing because
          // something went wrong", and D-23 was exactly the second reading.
          paymentUrl: null,
          paymentMode: "MANUAL",
          status: "AWAITING_CONFIRMATION",
          instructions: {
            amount: parsedAmount,
            currency: "PHP",
            type,
            itemTitle: rental.item.title,
            channel: env.PAYMENT_MANUAL_CHANNEL,
            accountName: env.PAYMENT_MANUAL_ACCOUNT_NAME ?? null,
            accountNumber: env.PAYMENT_MANUAL_ACCOUNT_NUMBER ?? null,
            confirmWindow: env.PAYMENT_MANUAL_CONFIRM_WINDOW,
            reference: transaction.id,
          },
        },
      });
      return;
    }

    // ── PayMongo mode (dormant — kept working, not deleted) ───────────────
    const successUrl = `${env.CLIENT_WEB_URL}/payments/success?tid=${transaction.id}`;
    const cancelUrl = `${env.CLIENT_WEB_URL}/payments/cancel?tid=${transaction.id}`;

    // Use real PayMongo when key is configured, otherwise return a mock URL
    let checkoutUrl = `${env.CLIENT_WEB_URL}/payments/mock?tid=${transaction.id}`;
    let checkoutId: string | null = null;

    if (env.PAYMONGO_SECRET_KEY) {
      try {
        const result = await createCheckoutSession({
          amount: parsedAmount,
          description: `${type === "RENTAL_PAYMENT" ? "Rental" : "Security Deposit"} for ${rental.item.title}`,
          rentalId,
          transactionId: transaction.id,
          successUrl,
          cancelUrl,
        });
        checkoutUrl = result.checkoutUrl;
        checkoutId = result.checkoutId;

        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { paymongoCheckoutId: checkoutId },
        });
      } catch (pmErr) {
        logger.error("PayMongo checkout session failed:", pmErr);
        // Fall through to mock URL — do not block the user
      }
    }

    logger.info(`Payment initiated: ${transaction.id} for rental ${rentalId}`);

    res.status(201).json({
      success: true,
      message: "Payment initiated",
      data: {
        transaction,
        paymentUrl: checkoutUrl,
        paymentMode: "PAYMONGO",
        status: "AWAITING_CHECKOUT",
      },
    });
  } catch (error) {
    next(error);
  }
};

// Called by PayMongo webhook OR manually in dev/demo
export const confirmPayment = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const isRealWebhook =
      req.body?.data?.type === "checkout_session.payment.paid";
    const sigHeader = req.headers["paymongo-signature"] as string | undefined;
    const rawBody = JSON.stringify(req.body);

    let transactionId: string;
    let paymentId: string | undefined;
    let referenceNo: string | undefined;

    if (isRealWebhook) {
      // A genuine PayMongo webhook must always carry a valid signature — no
      // exceptions. (Previously this branch only checked the signature *if*
      // a header happened to be present, and an unset secret made
      // verifyWebhookSignature() always pass — both holes are closed now.)
      if (!sigHeader || !verifyWebhookSignature(rawBody, sigHeader)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid webhook signature" });
        return;
      }

      const attrs = req.body.data.attributes;
      const meta = attrs?.metadata ?? {};
      transactionId = meta.transaction_id;
      paymentId = attrs?.payment_intent?.id ?? attrs?.payments?.[0]?.id;
      referenceNo = attrs?.reference_number;
    } else if (env.NODE_ENV !== "production") {
      // Manual/dev confirm — no PayMongo signature exists for this shape by
      // definition, so it's only reachable outside production. In
      // production, a request that isn't a signed real webhook is rejected
      // below rather than falling through to trusting arbitrary body fields
      // (previously any caller could mark any transactionId COMPLETED with
      // no verification at all).
      transactionId = req.body.transactionId;
      paymentId = req.body.paymentId;
      referenceNo = req.body.referenceNo;
    } else {
      res.status(400).json({
        success: false,
        message: "A verified PayMongo webhook signature is required",
      });
      return;
    }

    if (!transactionId) {
      res
        .status(400)
        .json({ success: false, message: "transactionId is required" });
      return;
    }

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

    if (!transaction) throw new NotFoundError("Transaction not found");

    // Dev-only: simulate a failed payment (client/web's /payments/mock
    // page). A real PayMongo webhook never reports "this payment failed"
    // through this endpoint — an actual failed checkout just never fires a
    // paid webhook — so this branch only exists outside production, gated
    // the same way the manual-confirm branch below is.
    if (
      !isRealWebhook &&
      env.NODE_ENV !== "production" &&
      req.body.status === "FAILED"
    ) {
      if (
        transaction.status === "COMPLETED" ||
        transaction.status === "REFUNDED"
      ) {
        res.json({ success: true, message: "Already confirmed" });
        return;
      }
      const failedTransaction = await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: "FAILED" },
      });
      logger.info(`Payment marked FAILED (dev/demo): ${transactionId}`);
      res.json({
        success: true,
        message: "Payment marked as failed",
        data: { transaction: failedTransaction },
      });
      return;
    }

    // Idempotency: webhook may fire multiple times — safe to ack without re-processing
    if (
      transaction.status === "COMPLETED" ||
      transaction.status === "REFUNDED"
    ) {
      res.json({ success: true, message: "Already confirmed" });
      return;
    }

    // Idempotency: mark PROCESSING first to prevent concurrent webhook duplicates
    const claimed = await prisma.transaction.updateMany({
      where: { id: transactionId, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) {
      // Another request already processing — return 200 so PayMongo doesn't retry
      res.json({ success: true, message: "Already processing" });
      return;
    }

    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: "COMPLETED",
        ...(referenceNo && { paymentReferenceNo: referenceNo }),
        ...(paymentId && { paymongoPaymentId: paymentId }),
        paidAt: new Date(),
      },
    });

    if (
      transaction.type === "RENTAL_PAYMENT" ||
      transaction.type === "SECURITY_DEPOSIT"
    ) {
      // Both RENTAL_PAYMENT and SECURITY_DEPOSIT must be COMPLETED before the
      // rental advances — previously either one alone triggered
      // AWAITING_DEPOSIT, so a renter could pay just the (refundable)
      // deposit, skip the actual rental fee entirely, and still have the
      // owner told to hand over the item at the kiosk.
      const otherType =
        transaction.type === "RENTAL_PAYMENT"
          ? "SECURITY_DEPOSIT"
          : "RENTAL_PAYMENT";
      const otherCompleted = await prisma.transaction.findFirst({
        where: {
          rentalId: transaction.rentalId,
          type: otherType,
          status: "COMPLETED",
        },
      });

      if (otherCompleted) {
        await prisma.rental.update({
          where: { id: transaction.rentalId },
          data: { status: "AWAITING_DEPOSIT" },
        });

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

        // Email renter
        if (transaction.rental.renter?.email) {
          const { sendPaymentReceived: sendPR } = await import("../utils/email");
          await sendPR(transaction.rental.renter.email, {
            firstName: transaction.rental.renter.firstName,
            amount: transaction.amount,
            itemTitle: transaction.rental.item.title,
            rentalId: transaction.rentalId,
          });
        }
      } else {
        // Only one of the two required payments is in — let the renter know
        // this one succeeded, but don't move the rental forward yet.
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

    logger.info(`Payment confirmed: ${transactionId}`);
    res.json({
      success: true,
      message: "Payment confirmed successfully",
      data: { transaction: updatedTransaction },
    });
  } catch (error) {
    next(error);
  }
};

// Polled by the Phone App's checkout WebView (payment_webview_screen.dart's
// "Check Status" button) as a fallback to the primary success/cancel
// redirect-navigation detection.
export const getPaymentStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const transactionId = req.params.transactionId as string;
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) throw new NotFoundError("Transaction not found");
    if (transaction.userId !== req.user.userId) {
      throw new ForbiddenError("You can only check your own transactions");
    }

    res.json({ success: true, data: { status: transaction.status } });
  } catch (error) {
    next(error);
  }
};

export const getTransactions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const { status, type, page = "1", limit = "10" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Record<string, unknown> = { userId: req.user.userId };
    if (status) where.status = status;
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take,
        include: { rental: { include: { item: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const refundPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const transactionId = req.params.transactionId as string;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { rental: { include: { item: true } } },
    });

    if (!transaction) throw new NotFoundError("Transaction not found");
    if (transaction.status !== "COMPLETED")
      throw new ValidationError("Only completed transactions can be refunded");

    // Attempt real PayMongo refund when payment ID is stored
    if (env.PAYMONGO_SECRET_KEY && transaction.paymongoPaymentId) {
      try {
        await createRefund({
          paymentId: transaction.paymongoPaymentId,
          amount: transaction.amount,
          reason: "others",
        });
      } catch (pmErr) {
        logger.error("PayMongo refund failed:", pmErr);
        throw new ValidationError(
          "PayMongo refund failed — please retry or contact support",
        );
      }
    }

    const refund = await prisma.transaction.create({
      data: {
        rentalId: transaction.rentalId,
        userId: transaction.userId,
        type: "DEPOSIT_REFUND",
        amount: transaction.amount,
        status: "COMPLETED",
        paidAt: new Date(),
        paymentMethod: "PayMongo",
      },
    });

    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: "REFUNDED" },
    });

    await prisma.notification.create({
      data: {
        userId: transaction.userId,
        title: "Refund Processed",
        message: `Refund of ₱${transaction.amount.toFixed(2)} has been processed via PayMongo`,
        type: "PAYMENT_RECEIVED",
        relatedEntityId: transaction.rentalId,
        relatedEntityType: "transaction",
      },
    });

    logger.info(`Payment refunded: ${transactionId}`);
    res.json({
      success: true,
      message: "Refund processed successfully",
      data: { refund },
    });
  } catch (error) {
    next(error);
  }
};
