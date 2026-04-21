import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../utils/errors";
import logger from "../utils/logger";
import env from "../config/env";
import crypto from "crypto";
import axios from "axios";

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

async function createRefund(params: {
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
// Webhook signature verification
// ---------------------------------------------------------------------------

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
): boolean {
  const secret = env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) return true; // Skip if not configured

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
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(expectedHash),
  );
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

export const createPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const { rentalId, type, amount } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true },
    });

    if (!rental) throw new NotFoundError("Rental not found");
    if (rental.renterId !== req.user.userId)
      throw new ForbiddenError(
        "You can only make payments for your own rentals",
      );

    const parsedAmount = parseFloat(amount);

    const transaction = await prisma.transaction.create({
      data: {
        rentalId,
        userId: req.user.userId,
        type,
        amount: parsedAmount,
        status: "PENDING",
        paymentMethod: "PayMongo",
      },
    });

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
      data: { transaction, paymentUrl: checkoutUrl },
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
    // Webhook signature check
    const sigHeader = req.headers["paymongo-signature"] as string | undefined;
    const rawBody = JSON.stringify(req.body);

    if (sigHeader && !verifyWebhookSignature(rawBody, sigHeader)) {
      res
        .status(400)
        .json({ success: false, message: "Invalid webhook signature" });
      return;
    }

    // PayMongo webhook payload vs manual dev call
    let transactionId: string;
    let paymentId: string | undefined;
    let referenceNo: string | undefined;

    if (req.body?.data?.type === "checkout_session.payment.paid") {
      // Real PayMongo webhook
      const attrs = req.body.data.attributes;
      const meta = attrs?.metadata ?? {};
      transactionId = meta.transaction_id;
      paymentId = attrs?.payment_intent?.id ?? attrs?.payments?.[0]?.id;
      referenceNo = attrs?.reference_number;
    } else {
      // Manual / dev confirm
      transactionId = req.body.transactionId;
      paymentId = req.body.paymentId;
      referenceNo = req.body.referenceNo;
    }

    if (!transactionId) {
      res
        .status(400)
        .json({ success: false, message: "transactionId is required" });
      return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { rental: { include: { item: true } } },
    });

    if (!transaction) throw new NotFoundError("Transaction not found");
    if (transaction.status === "COMPLETED") {
      res.json({ success: true, message: "Already confirmed" });
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
