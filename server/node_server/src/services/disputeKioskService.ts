import type { Server } from "socket.io";
import prisma from "../config/database";
import env from "../config/env";
import logger from "../utils/logger";
import { notifyAdmins } from "./adminRoom";
import { grantBayAccess } from "./kioskBayAccessStore";
import { assignLocker } from "./faceVerificationService";
import { baysHoldingWrongItems } from "./disputeWrongItemService";
import { recordEvent, tellParty } from "./disputeEvents";
import { disputeMoney, freezeFees, resumeFees, RENTER_ACTION_STATUSES } from "./disputeService";
import { peso } from "./disputeMessages";
import {
  createCheckoutSession,
  expireCheckoutSession,
} from "./paymongoService";
import { activeEnv, assertGatewayMode, envOf, GatewayWaking, wake } from "./paymentGateway";

/** D2 (user ruling 2026-10-19): a kiosk dispute fee waits this long for a waking gateway, then offers GCash with admin confirmation. */
export const GATEWAY_WAIT_MS = 90_000;

/**
 * Ruling 6 — pay AT THE KIOSK, before the door unlocks.
 *
 *   scan the kiosk QR + face on the phone  ->  a VISIT opens (10 min)
 *   the kiosk and the phone show the amount owed
 *   the renter pays: PayMongo first, manual admin confirmation as the fallback
 *   payment confirmed  ->  a bay is assigned and the upper door is GRANTED
 *   the renter places the correct item; the AI checks it; an admin reviews it
 *
 * A visit is created ONLY by a face verification that already passed
 * (applyFaceVerificationOutcome), exactly like a bay grant: nothing a client
 * sends can open one. In memory on purpose, like the grants: a restart drops
 * every visit, so a door never opens because of something a previous process
 * believed. A payment that lands after its visit ended still counts: the case
 * becomes PAID and the next scan goes straight to the door.
 *
 * "Nothing charged twice": one live DISPUTE_FEE row per case. A second tap
 * returns the same row; a PayMongo checkout left unpaid when the visit ends is
 * EXPIRED at PayMongo, so it can no longer be paid.
 */

export const VISIT_MS = 10 * 60_000;

interface Visit {
  rentalId: string;
  disputeId: string;
  userId: string;
  kioskId: string;
  startedAt: number;
  expiresAt: number;
  transactionId: string | null;
  doorGranted: boolean;
  timer: NodeJS.Timeout;
}

const visits = new Map<string, Visit>();

export function getVisit(rentalId: string): Omit<Visit, "timer"> | null {
  const v = visits.get(rentalId);
  if (!v || Date.now() >= v.expiresAt) return null;
  const { timer: _timer, ...rest } = v;
  return rest;
}

export function liveVisitForDispute(disputeId: string): Omit<Visit, "timer"> | null {
  for (const v of visits.values()) if (v.disputeId === disputeId && Date.now() < v.expiresAt) return getVisit(v.rentalId);
  return null;
}

/** Test seam. */
export function _clearVisits(): void {
  for (const v of visits.values()) clearTimeout(v.timer);
  visits.clear();
}

async function activeCase(rentalId: string) {
  return prisma.dispute.findFirst({
    where: { rentalId, status: { in: [...RENTER_ACTION_STATUSES] } },
    orderBy: { openedAt: "desc" },
  });
}

export type VisitStart =
  | { action: "dispute_pay"; disputeId: string; amount: number; expiresAt: number; pendingTransactionId: string | null }
  | { action: "return"; lockerNumber: string; grantExpiresAt: number }
  | { action: "none"; error: string };

/**
 * Called from applyFaceVerificationOutcome for a DISPUTED rental, after the
 * renter's face has verified.
 */
export async function startDisputeVisit(
  io: Server,
  p: { rentalId: string; userId: string; kioskId: string },
): Promise<VisitStart> {
  const d = await activeCase(p.rentalId);
  if (!d) {
    return {
      action: "none",
      error: "This return is with an admin for review. You'll be told when there is something to do.",
    };
  }
  const existing = visits.get(p.rentalId);
  if (existing) clearTimeout(existing.timer);

  const now = Date.now();
  const visit: Visit = {
    rentalId: p.rentalId,
    disputeId: d.id,
    userId: p.userId,
    kioskId: p.kioskId,
    startedAt: now,
    expiresAt: now + VISIT_MS,
    transactionId: null,
    doorGranted: false,
    timer: setTimeout(() => void endVisit(io, p.rentalId, "timeout"), VISIT_MS),
  };
  visit.timer.unref?.();
  visits.set(p.rentalId, visit);
  wake(); // a dispute fee may be paid in this visit: wake the gateway now (SPEC §4)

  await recordEvent(d.id, {
    type: "KIOSK_VISIT",
    actorRole: "RENTER",
    actorId: p.userId,
    channel: "KIOSK",
    message: `The renter scanned kiosk ${p.kioskId} and verified their face.`,
  });

  const money = await disputeMoney(d);
  if (money.owed <= 0) {
    if (d.status === "OPEN") await prisma.dispute.update({ where: { id: d.id }, data: { status: "PAID" } });
    return grantDisputeReturn(io, p.rentalId);
  }

  const pending = await prisma.transaction.findFirst({
    where: { disputeId: d.id, type: "DISPUTE_FEE", status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (pending) visit.transactionId = pending.id;

  io.to(`kiosk:${p.kioskId}`).emit("kiosk:command", {
    action: "dispute_payment",
    rental_id: p.rentalId,
    reference: d.referenceNo,
    amount: money.owed,
    amount_text: peso(money.owed),
    expires_at: visit.expiresAt,
    message: `Amount owed: ${peso(money.owed)}. Pay on your phone; the locker opens once the payment is confirmed.`,
  });
  io.to(`user:${p.userId}`).emit("dispute:payment_required", {
    rentalId: p.rentalId,
    disputeId: d.id,
    amount: money.owed,
    expiresAt: visit.expiresAt,
  });
  return {
    action: "dispute_pay",
    disputeId: d.id,
    amount: money.owed,
    expiresAt: visit.expiresAt,
    pendingTransactionId: pending?.id ?? null,
  };
}

export interface DisputePaymentStart {
  transactionId: string;
  amount: number;
  paymentMode: "PAYMONGO" | "MANUAL";
  paymentUrl: string | null;
  testMode: boolean;
  instructions: Record<string, unknown> | null;
  expiresAt: number;
}

/** The renter tapped "Pay" during a live visit. */
export async function createDisputePayment(
  io: Server,
  p: { disputeId: string; userId: string },
): Promise<DisputePaymentStart> {
  const d = await prisma.dispute.findUnique({
    where: { id: p.disputeId },
    include: { rental: { include: { item: { select: { title: true } } } } },
  });
  if (!d) throw new Error("Case not found");
  if (d.renterId !== p.userId) throw new Error("This case belongs to someone else");
  const visit = visits.get(d.rentalId);
  if (!visit || visit.userId !== p.userId || Date.now() >= visit.expiresAt) {
    throw new Error("Pay at the kiosk: scan the kiosk QR code and verify your face first");
  }

  // Reuse the live row, never a second charge for one debt.
  let tx = await prisma.transaction.findFirst({
    where: { disputeId: d.id, type: "DISPUTE_FEE", status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
  });
  const money = await disputeMoney(d);
  if (!tx && money.owed <= 0) throw new Error("Nothing is owed on this case right now");

  let paymentUrl: string | null = (tx?.paymentDetails as { checkoutUrl?: string } | null)?.checkoutUrl ?? null;
  let mode: "PAYMONGO" | "MANUAL" = tx ? (tx.paymongoCheckoutId ? "PAYMONGO" : "MANUAL") : "PAYMONGO";

  // P2: check the gateway before recording a payment. A sleeping gateway gets
  // "Connecting…" until GATEWAY_WAIT_MS after the visit started (it was woken
  // when the visit began), then the manual fallback (D2). A gateway that
  // reports the wrong mode fails closed into the manual fallback at once.
  let gatewayOk = false;
  const gw = activeEnv();
  if (!tx && gw) {
    try {
      await assertGatewayMode(gw);
      gatewayOk = true;
    } catch (err) {
      if (err instanceof GatewayWaking && Date.now() - visit.startedAt < GATEWAY_WAIT_MS) throw err;
      logger.error(`[DISPUTE] payment gateway unavailable for ${d.referenceNo} (${(err as Error).message}); manual fallback`);
    }
  }

  if (!tx) {
    tx = await prisma.transaction.create({
      data: {
        rentalId: d.rentalId,
        userId: d.renterId,
        type: "DISPUTE_FEE",
        amount: money.owed,
        status: "PENDING",
        paymentMethod: "PayMongo",
        disputeId: d.id,
        paymentDetails: { kioskVisit: true, kioskId: visit.kioskId } as never,
      },
    });
    mode = "MANUAL";
    if (gatewayOk) {
      try {
        const checkout = await createCheckoutSession({
          amount: money.owed,
          name: "EngiRent dispute fee",
          description: `Dispute fee ${d.referenceNo} (${d.rental.item.title})`,
          successUrl: `${env.CLIENT_WEB_URL}/payments/success?tid=${tx.id}`,
          cancelUrl: `${env.CLIENT_WEB_URL}/payments/cancel?tid=${tx.id}`,
          metadata: { rental_id: d.rentalId, transaction_id: tx.id, dispute_id: d.id },
        });
        paymentUrl = checkout.checkoutUrl;
        mode = "PAYMONGO";
        tx = await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            paymongoCheckoutId: checkout.checkoutId,
            paymentEnv: checkout.paymentEnv,
            paymentDetails: { kioskVisit: true, kioskId: visit.kioskId, checkoutUrl: checkout.checkoutUrl } as never,
          },
        });
      } catch (err) {
        // The fallback (ruling 6): PayMongo is unavailable, so a person confirms.
        logger.error(`[DISPUTE] PayMongo checkout failed for ${d.referenceNo}; manual fallback:`, err);
      }
    }
    if (mode === "MANUAL") {
      tx = await prisma.transaction.update({ where: { id: tx.id }, data: { paymentMethod: "Manual" } });
    }

    await prisma.dispute.update({ where: { id: d.id }, data: { status: "PAYMENT_PENDING" } });
    await freezeFees(d.id, `Payment of ${peso(money.owed)} submitted (${mode === "PAYMONGO" ? "PayMongo" : "manual"}): fees are frozen.`);
    await recordEvent(d.id, {
      type: "PAYMENT_SUBMITTED",
      actorRole: "RENTER",
      actorId: p.userId,
      channel: "KIOSK",
      message: `${peso(money.owed)} via ${mode === "PAYMONGO" ? `PayMongo${envOf(tx) === "sandbox" ? " (TEST mode: simulated, no real money)" : ""}` : "manual transfer, waiting for an admin"}.`,
      metadata: { transactionId: tx.id },
    });
    if (mode === "MANUAL") {
      notifyAdmins(io, "admin:kiosk_payment_waiting", {
        disputeId: d.id,
        referenceNo: d.referenceNo,
        transactionId: tx.id,
        amount: money.owed,
        kioskId: visit.kioskId,
        renterId: d.renterId,
        expiresAt: visit.expiresAt,
      });
    }
  }
  visit.transactionId = tx.id;

  io.to(`kiosk:${visit.kioskId}`).emit("kiosk:command", {
    action: "dispute_payment_waiting",
    rental_id: d.rentalId,
    amount: tx.amount,
    amount_text: peso(tx.amount),
    mode,
    expires_at: visit.expiresAt,
    message: mode === "PAYMONGO" ? "Complete the payment on your phone" : "Waiting for staff to confirm your payment",
  });

  return {
    transactionId: tx.id,
    amount: tx.amount,
    paymentMode: mode,
    paymentUrl,
    testMode: mode === "PAYMONGO" && envOf(tx) === "sandbox",
    instructions:
      mode === "MANUAL"
        ? {
            amount: tx.amount,
            currency: "PHP",
            channel: env.PAYMENT_MANUAL_CHANNEL,
            accountName: env.PAYMENT_MANUAL_ACCOUNT_NAME ?? null,
            accountNumber: env.PAYMENT_MANUAL_ACCOUNT_NUMBER ?? null,
            reference: d.referenceNo,
            note: "Staff have been alerted and will confirm the payment while you wait at the kiosk.",
          }
        : null,
    expiresAt: visit.expiresAt,
  };
}

/** Grant the upper door for the return, in a bay that holds none of this rental's wrong items. */
export async function grantDisputeReturn(io: Server, rentalId: string): Promise<VisitStart> {
  const visit = visits.get(rentalId);
  if (!visit || Date.now() >= visit.expiresAt) return { action: "none", error: "The kiosk visit has ended" };
  const exclude = await baysHoldingWrongItems(rentalId);
  const assigned = await assignLocker(io, visit.kioskId, rentalId, false, exclude);
  if (!assigned) {
    io.to(`kiosk:${visit.kioskId}`).emit("kiosk:command", {
      action: "flow_error",
      rental_id: rentalId,
      message: "No locker is free right now. Your payment is safe; please try again shortly.",
    });
    return { action: "none", error: "No locker is free at this kiosk right now. Your payment is kept; try again shortly." };
  }
  const grant = grantBayAccess({
    rentalId,
    userId: visit.userId,
    kioskId: visit.kioskId,
    action: "return",
    lockerNumber: assigned.lockerNumber,
    door: "main_door",
  });
  visit.doorGranted = true;
  // The same event a normal return's face check sends, so the phone continues
  // into its existing "Open Kiosk Now" / "Item is placed" steps unchanged.
  io.to(`user:${visit.userId}`).emit("face:verified", {
    rentalId,
    action: "return",
    kioskId: visit.kioskId,
    lockerNumber: assigned.lockerNumber,
    grantExpiresAt: grant.expiresAt,
  });
  io.to(`kiosk:${visit.kioskId}`).emit("kiosk:command", {
    action: "dispute_door_ready",
    rental_id: rentalId,
    locker_id: parseInt(assigned.lockerNumber, 10),
    message: `Payment confirmed. Use your phone to open locker ${assigned.lockerNumber} and place the correct item.`,
  });
  await recordEvent(visit.disputeId, {
    type: "DOOR_GRANTED",
    actorRole: "SYSTEM",
    channel: "KIOSK",
    message: `Upper door of locker ${assigned.lockerNumber} granted for the return.`,
  });
  return { action: "return", lockerNumber: assigned.lockerNumber, grantExpiresAt: grant.expiresAt };
}

/** paymentConfirmationService calls this when a DISPUTE_FEE is confirmed by any route. */
export async function onDisputePaymentConfirmed(
  io: Server | undefined,
  disputeId: string,
  transactionId: string,
  via: string,
): Promise<void> {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d) return;
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (d.status === "PAYMENT_PENDING" || d.status === "OPEN") {
    await prisma.dispute.update({ where: { id: disputeId }, data: { status: "PAID" } });
  }
  await recordEvent(disputeId, {
    type: "PAYMENT_CONFIRMED",
    actorRole: via === "ADMIN_MANUAL" ? "ADMIN" : "SYSTEM",
    message: `${peso(tx?.amount ?? 0)} confirmed (${via}).`,
    metadata: { transactionId },
  });
  if (io) {
    await tellParty(io, d, "RENTER", "Payment confirmed", `Your payment of ${peso(tx?.amount ?? 0)} for case ${d.referenceNo} is confirmed. Fees are frozen.`, {});
    const visit = visits.get(d.rentalId);
    if (visit && Date.now() < visit.expiresAt && !visit.doorGranted) {
      await grantDisputeReturn(io, d.rentalId);
    }
  }
}

export async function onDisputePaymentFailed(
  io: Server | undefined,
  disputeId: string,
  transactionId: string,
  reason: string,
): Promise<void> {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d) return;
  if (d.status === "PAYMENT_PENDING") await prisma.dispute.update({ where: { id: disputeId }, data: { status: "OPEN" } });
  await recordEvent(disputeId, {
    type: "PAYMENT_REJECTED",
    actorRole: reason === "ADMIN_MANUAL" ? "ADMIN" : "SYSTEM",
    message: `Payment not completed (${reason}).`,
    metadata: { transactionId },
  });
  await resumeFees(disputeId, "The payment was not completed: fees resume (ruling 7).");
  const visit = visits.get(d.rentalId);
  if (io && visit && Date.now() < visit.expiresAt) {
    visit.transactionId = null;
    io.to(`kiosk:${visit.kioskId}`).emit("kiosk:command", {
      action: "dispute_payment",
      rental_id: d.rentalId,
      reference: d.referenceNo,
      amount: (await disputeMoney((await prisma.dispute.findUnique({ where: { id: disputeId } }))!)).owed,
      expires_at: visit.expiresAt,
      message: "The payment did not go through. Try again on your phone.",
    });
  }
}

/** The return was placed: the visit has done its job. */
export function finishVisit(rentalId: string): void {
  const v = visits.get(rentalId);
  if (!v) return;
  clearTimeout(v.timer);
  visits.delete(rentalId);
}

/**
 * The visit ended without a return (10 min passed, or the renter cancelled).
 * Ends safely: an unpaid PayMongo checkout is expired at PayMongo so it can
 * never be paid afterwards; a manual payment stays with the admin (fees stay
 * frozen until they decide); a paid case whose return did not happen resumes
 * its fees (ruling 7).
 */
export async function endVisit(io: Server, rentalId: string, why: "timeout" | "cancelled"): Promise<void> {
  const v = visits.get(rentalId);
  if (!v) return;
  clearTimeout(v.timer);
  visits.delete(rentalId);

  const d = await prisma.dispute.findUnique({ where: { id: v.disputeId } });
  if (!d) return;
  if (d.status === "RETURN_REVIEW") return; // the return happened

  if (v.transactionId) {
    const tx = await prisma.transaction.findUnique({ where: { id: v.transactionId } });
    if (tx && (tx.status === "PENDING" || tx.status === "PROCESSING") && tx.paymongoCheckoutId) {
      try {
        const e = envOf(tx);
        if (e) await expireCheckoutSession(e, tx.paymongoCheckoutId);
      } catch (err) {
        logger.warn(`[DISPUTE] could not expire checkout ${tx.paymongoCheckoutId}: ${(err as Error).message}`);
      }
      // One last look: it may have been paid in the final seconds.
      const { pollOne } = await import("./paymentPoller");
      const state = await pollOne(io, tx.id);
      if (state !== "paid") {
        const { markTransactionFailed } = await import("./paymentConfirmationService");
        await markTransactionFailed(io, tx.id, { via: "VISIT_TIMEOUT", reason: "the kiosk visit ended before the payment completed" });
      }
    }
  }

  const fresh = await prisma.dispute.findUnique({ where: { id: v.disputeId } });
  if (fresh?.status === "PAID") {
    await prisma.dispute.update({ where: { id: fresh.id }, data: { status: "OPEN" } });
    await resumeFees(fresh.id, "Paid, but the kiosk visit ended without the item being returned: fees resume (ruling 7).");
  }
  await recordEvent(v.disputeId, {
    type: "KIOSK_VISIT_ENDED",
    actorRole: "SYSTEM",
    channel: "KIOSK",
    message: why === "timeout" ? "The kiosk visit ended after 10 minutes without a return." : "The renter cancelled the kiosk visit.",
  });
  io.to(`kiosk:${v.kioskId}`).emit("kiosk:command", {
    action: "flow_error",
    rental_id: rentalId,
    message:
      why === "timeout"
        ? "This session has ended. Nothing was charged twice. Scan the QR code again when you are ready."
        : "Session cancelled. Scan the QR code again when you are ready.",
  });
  io.to(`user:${v.userId}`).emit("dispute:visit_ended", { rentalId, disputeId: v.disputeId, why });
}
