import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { paymongoConfigured, retrieveCheckoutSession, expireCheckoutSession } from "./paymongoService";
import { markTransactionFailed, markTransactionPaid } from "./paymentConfirmationService";

/**
 * Ruling 6 (2026-10-11): confirm PayMongo payments by ASKING PayMongo, not by
 * waiting for its webhook. The API sits behind a Cloudflare quick tunnel whose
 * hostname changes on every restart, and the registered webhook points at a
 * dead host, so a webhook-only design would leave a renter standing at the
 * kiosk with a paid checkout and a locked door.
 *
 * Every pending checkout younger than 2 hours is checked every 5 seconds;
 * older ones (up to 2 days) every 5 minutes. The webhook still works when it
 * can arrive; both routes go through markTransactionPaid, which is idempotent.
 *
 * A DISPUTE_FEE checkout belongs to a kiosk visit. If none is live any more (the
 * API restarted, or the visit ended) and it is older than 15 minutes, it is
 * expired at PayMongo and marked failed, so the fees resume and it can never
 * be paid by surprise later.
 */

const FAST_MS = 5_000;
const SLOW_EVERY = 60; // ticks: 60 x 5 s = 5 min
const FAST_WINDOW_MS = 2 * 3_600_000;
const SLOW_WINDOW_MS = 48 * 3_600_000;
const ORPHAN_DISPUTE_FEE_MS = 15 * 60_000;

let tick = 0;
let running = false;

/** Check one transaction now. Returns what PayMongo said, or "skip". */
export async function pollOne(io: Server | undefined, transactionId: string): Promise<"paid" | "expired" | "open" | "skip"> {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx?.paymongoCheckoutId || !(tx.status === "PENDING" || tx.status === "PROCESSING")) return "skip";
  const state = await retrieveCheckoutSession(tx.paymongoCheckoutId);
  if (state.state === "paid") {
    await markTransactionPaid(io, tx.id, { via: "PAYMONGO_POLL", paymentId: state.paymentId, referenceNo: state.referenceNo });
  } else if (state.state === "expired") {
    await markTransactionFailed(io, tx.id, { via: "CHECKOUT_EXPIRED", reason: "the PayMongo checkout expired" });
  }
  return state.state;
}

async function sweep(io: Server): Promise<void> {
  if (running || !paymongoConfigured()) return;
  running = true;
  try {
    tick += 1;
    const slow = tick % SLOW_EVERY === 0;
    const now = Date.now();
    const rows = await prisma.transaction.findMany({
      where: {
        status: "PENDING",
        paymongoCheckoutId: { not: null },
        createdAt: { gte: new Date(now - (slow ? SLOW_WINDOW_MS : FAST_WINDOW_MS)) },
      },
      select: { id: true, type: true, createdAt: true, paymongoCheckoutId: true, disputeId: true, rentalId: true },
      take: 50,
    });
    for (const row of rows) {
      try {
        const state = await pollOne(io, row.id);
        if (state === "open" && row.type === "DISPUTE_FEE" && now - row.createdAt.getTime() > ORPHAN_DISPUTE_FEE_MS) {
          const { getVisit } = await import("./disputeKioskService");
          if (!getVisit(row.rentalId)) {
            try {
              await expireCheckoutSession(row.paymongoCheckoutId as string);
            } catch {
              /* already closed: the failure below still applies */
            }
            await markTransactionFailed(io, row.id, {
              via: "VISIT_TIMEOUT",
              reason: "no kiosk visit is waiting for this payment any more",
            });
          }
        }
      } catch (err) {
        logger.warn(`[PAYMONGO-POLL] ${row.id}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    logger.error("[PAYMONGO-POLL] sweep failed:", err);
  } finally {
    running = false;
  }
}

export function startPaymentPoller(io: Server): void {
  const t = setInterval(() => void sweep(io), FAST_MS);
  t.unref?.();
  logger.info(`[PAYMONGO-POLL] started (${paymongoConfigured() ? "PayMongo configured" : "PayMongo NOT configured: manual fallback only"})`);
}
