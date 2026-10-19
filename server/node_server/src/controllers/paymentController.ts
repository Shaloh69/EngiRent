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
import { listReceivingInstitutions } from "../services/payoutService";
import { confirmFromCheckout, createCheckoutSession } from "../services/paymongoService";
import {
  activeEnv,
  assertGatewayMode,
  envOf,
  GatewayUnavailable,
  GatewayWaking,
  refund as gatewayRefund,
  verifyGatewayEvent,
  WAKING_MESSAGE,
} from "../services/paymentGateway";
import { markTransactionPaid } from "../services/paymentConfirmationService";

// ---------------------------------------------------------------------------
// Refunds (through the payment gateway, P2)
// ---------------------------------------------------------------------------

/**
 * Refund (part of) a PayMongo payment through the gateway the payment was MADE
 * in (`from` is the original transaction row), not the active one: a sandbox
 * payment can only be refunded by the sandbox, and a live one by live.
 * Throws when that gateway is not configured here, so every caller keeps the
 * money owed and tells a person, instead of recording a refund that never
 * left (before P2 the callers keyed on PAYMONGO_SECRET_KEY, which SPEC §8.5
 * removes, and would then have recorded ledger-only refunds as COMPLETED).
 * Works under PAYMENT_MODE=MANUAL: the kill switch stops new payments, not
 * refunds of money already taken.
 */
export async function createRefund(params: {
  paymentId: string;
  amount: number; // PHP
  reason: string;
  from: { paymentEnv?: string | null; paymongoCheckoutId?: string | null; paymongoPaymentId?: string | null };
}): Promise<string> {
  const e = envOf(params.from);
  if (!e) {
    throw new GatewayUnavailable(`Cannot refund PayMongo payment ${params.paymentId}: no payment gateway is recorded for it`);
  }
  // An unconfigured gateway is refused inside gatewayRefund (paymentGateway.need).
  const out = await gatewayRefund(e, { paymentId: params.paymentId, amount: params.amount, reason: params.reason });
  return out.refundId;
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
    // Empty when no gateway is configured (listReceivingInstitutions).
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

    // Ruling 6 (2026-10-11), extended by the user to ALL payments: PayMongo is
    // PRIMARY; manual admin confirmation is the FALLBACK, used whenever a
    // checkout cannot be created (no key, PAYMENT_MODE=MANUAL kill switch, or
    // PayMongo failing). The old mock-URL fallback is gone: it sent a renter to
    // a page that could never take their money.
    const existingCheckoutUrl =
      (existing?.paymentDetails as { checkoutUrl?: string } | null)?.checkoutUrl ?? null;

    // P2: a checkout will be needed. Check the gateway BEFORE recording
    // anything: a sleeping one (free Render, ~1 min to wake) gets the SPEC §5
    // message and a retry, not a silent switch to manual GCash; a gateway that
    // reports the wrong mode fails closed into the manual fallback below.
    let gatewayOk = false;
    const gw = activeEnv();
    if (gw && !existingCheckoutUrl && !existing?.paymongoCheckoutId) {
      try {
        await assertGatewayMode(gw);
        gatewayOk = true;
      } catch (gwErr) {
        if (gwErr instanceof GatewayWaking) {
          res.status(503).json({
            success: false,
            code: "PAYMENT_SERVICE_WAKING",
            message: WAKING_MESSAGE,
            data: { retryAfterSeconds: 10 },
          });
          return;
        }
        logger.error(`[PAYMENT] ${(gwErr as Error).message} Using the manual fallback.`);
      }
    }

    let transaction =
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
          paymentMethod: gatewayOk ? "PayMongo" : "Manual",
        },
      }));

    let checkoutUrl: string | null = existingCheckoutUrl;
    if (!checkoutUrl && !transaction.paymongoCheckoutId && gatewayOk) {
      try {
        const result = await createCheckoutSession({
          amount: parsedAmount,
          name: "EngiRent Rental",
          description: `${type === "RENTAL_PAYMENT" ? "Rental" : "Security Deposit"} for ${rental.item.title}`,
          successUrl: `${env.CLIENT_WEB_URL}/payments/success?tid=${transaction.id}`,
          cancelUrl: `${env.CLIENT_WEB_URL}/payments/cancel?tid=${transaction.id}`,
          metadata: { rental_id: rentalId, transaction_id: transaction.id },
        });
        checkoutUrl = result.checkoutUrl;
        transaction = await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            paymongoCheckoutId: result.checkoutId,
            paymentEnv: result.paymentEnv,
            paymentMethod: "PayMongo",
            paymentDetails: { checkoutUrl: result.checkoutUrl } as never,
          },
        });
      } catch (pmErr) {
        logger.error("PayMongo checkout session failed; using the manual fallback:", pmErr);
      }
    }

    // ── PayMongo (primary) ────────────────────────────────────────────────
    if (checkoutUrl) {
      logger.info(`Payment initiated via PayMongo: ${transaction.id} for rental ${rentalId}`);
      res.status(201).json({
        success: true,
        message: "Payment initiated",
        data: {
          transaction,
          paymentUrl: checkoutUrl,
          paymentMode: "PAYMONGO",
          status: "AWAITING_CHECKOUT",
          // A sandbox-gateway payment is simulated: no real money moves.
          // From the row, not the active mode: a reused sandbox checkout
          // stays a test payment after a switch to live.
          testMode: envOf(transaction) === "sandbox",
        },
      });
      return;
    }

    // ── Manual (fallback) ─────────────────────────────────────────────────
    // No checkout. The renter is told what to send and where; an admin
    // confirms receipt through POST /admin/transactions/:id/decide-payment.
    if (transaction.paymentMethod === "PayMongo") {
      // PayMongo was tried for this row and is unavailable: relabel it.
      transaction = await prisma.transaction.update({
        where: { id: transaction.id },
        data: { paymentMethod: "Manual" },
      });
    }
    logger.info(`Payment awaiting manual confirmation: ${transaction.id} for rental ${rentalId}`);
    res.status(201).json({
      success: true,
      message: "Payment recorded — awaiting confirmation",
      data: {
        transaction,
        // Explicitly null rather than absent: "no checkout, by design" must
        // not read as "the field is missing because something went wrong" (D-23).
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

    // One confirmation path for the webhook, the poller and the admin
    // (paymentConfirmationService). Idempotent: PayMongo may fire twice.
    const outcome = await markTransactionPaid(req.app?.get("io"), transactionId, {
      via: isRealWebhook ? "PAYMONGO_WEBHOOK" : "DEV",
      paymentId,
      referenceNo,
    });
    res.json({
      success: true,
      message:
        outcome.status === "confirmed"
          ? "Payment confirmed successfully"
          : outcome.status === "already"
            ? "Already confirmed"
            : "Already processing",
      data: { transaction: outcome.transaction },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /payments/gateway-event — a PayMongo webhook, verified and forwarded by
 * the payment gateway on Render (SPEC-PAYMENT-GATEWAY.md §3.3, §6).
 *
 * Public (the gateway has no user), so it is authenticated by
 * X-Gateway-Signature = HMAC(that mode's gateway token, `${ts}.${rawBody}`),
 * refused when older than 5 minutes. Even a valid event decides NOTHING by
 * itself: confirmFromCheckout asks the transaction's own gateway for the
 * checkout and confirms only if PayMongo says paid, for exactly the
 * transaction's amount. A sandbox event can never touch a live row. The poller
 * does the same work every 5 s, so an event refused or lost here only means a
 * slower confirmation. The gateway does not retry a 4xx.
 */
export const gatewayEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const raw = (req as unknown as { rawBody?: string }).rawBody;
    const mode = req.body?.mode;
    if (typeof raw !== "string" || (mode !== "sandbox" && mode !== "live")) {
      res.status(400).json({ success: false, message: "Not a gateway event" });
      return;
    }
    const why = verifyGatewayEvent(
      mode,
      raw,
      req.header("X-Gateway-Timestamp") ?? undefined,
      req.header("X-Gateway-Signature") ?? undefined,
    );
    if (why) {
      logger.warn(`[GATEWAY-EVENT] refused (${mode}): ${why}`);
      res.status(401).json({ success: false, message: "Invalid gateway signature" });
      return;
    }
    const checkoutId = req.body?.checkoutId;
    if (typeof checkoutId !== "string" || !checkoutId) {
      // e.g. a payment.paid event: no checkout to look up; the poller covers it.
      res.status(202).json({ success: true, outcome: "ignored" });
      return;
    }
    const tx = await prisma.transaction.findUnique({ where: { paymongoCheckoutId: checkoutId } });
    if (!tx) {
      res.status(404).json({ success: false, message: "No transaction for this checkout" });
      return;
    }
    if (envOf(tx) !== mode) {
      logger.error(`[GATEWAY-EVENT] ${mode} event for ${tx.id}, which belongs to the ${envOf(tx) ?? "manual"} rail: refused`);
      res.status(409).json({ success: false, message: "Event mode does not match the transaction" });
      return;
    }
    const outcome = await confirmFromCheckout(req.app?.get("io"), tx.id, "PAYMONGO_WEBHOOK");
    logger.info(`[GATEWAY-EVENT] ${req.body?.type ?? "event"} ${checkoutId} -> ${outcome}`);
    res.json({ success: true, outcome });
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

    // A PayMongo payment is refunded through its own gateway, or not at all:
    // a failure leaves it COMPLETED (still owed), never a ledger-only "refund".
    if (transaction.paymongoPaymentId) {
      try {
        await createRefund({
          paymentId: transaction.paymongoPaymentId,
          amount: transaction.amount,
          reason: "others",
          from: transaction,
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
