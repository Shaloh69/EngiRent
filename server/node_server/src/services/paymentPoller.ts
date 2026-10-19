import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { confirmFromCheckout, expireCheckoutSession, CheckoutOutcome } from "./paymongoService";
import { markTransactionFailed } from "./paymentConfirmationService";
import { activeEnv, envOf, gatewayConfigured } from "./paymentGateway";

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
 *
 * P2 (SPEC-PAYMENT-GATEWAY.md §3.2): each row is asked about through the
 * gateway of its OWN paymentEnv, and confirmed only by confirmFromCheckout
 * (paid AND the same amount). The sweep runs while ANY gateway is configured,
 * even under the PAYMENT_MODE=MANUAL kill switch: stopping new payments must
 * not strand a checkout someone already paid.
 */

const FAST_MS = 5_000;
const SLOW_EVERY = 60; // ticks: 60 x 5 s = 5 min
const FAST_WINDOW_MS = 2 * 3_600_000;
const SLOW_WINDOW_MS = 48 * 3_600_000;
const ORPHAN_DISPUTE_FEE_MS = 15 * 60_000;

let tick = 0;
let running = false;

/** Check one transaction now, on its own gateway. Returns what PayMongo said, or "skip". */
export async function pollOne(io: Server | undefined, transactionId: string): Promise<CheckoutOutcome> {
  return confirmFromCheckout(io, transactionId, "PAYMONGO_POLL");
}

function anyGatewayConfigured(): boolean {
  return gatewayConfigured("sandbox") || gatewayConfigured("live");
}

async function sweep(io: Server): Promise<void> {
  if (running || !anyGatewayConfigured()) return;
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
      select: { id: true, type: true, createdAt: true, paymongoCheckoutId: true, paymentEnv: true, disputeId: true, rentalId: true },
      take: 50,
    });
    for (const row of rows) {
      try {
        const state = await pollOne(io, row.id);
        if (state === "open" && row.type === "DISPUTE_FEE" && now - row.createdAt.getTime() > ORPHAN_DISPUTE_FEE_MS) {
          const { getVisit } = await import("./disputeKioskService");
          if (!getVisit(row.rentalId)) {
            try {
              const e = envOf(row);
              if (e) await expireCheckoutSession(e, row.paymongoCheckoutId as string);
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

/** Test seam: one sweep, now. */
export const _sweepOnce = (io: Server): Promise<void> => sweep(io);

export function startPaymentPoller(io: Server): void {
  const t = setInterval(() => void sweep(io), FAST_MS);
  t.unref?.();
  const e = activeEnv();
  logger.info(
    `[PAYMONGO-POLL] started (new payments: ${e ? `${e} gateway` : "manual fallback only"}; polling gateways: ${
      ["sandbox", "live"].filter((g) => gatewayConfigured(g as "sandbox" | "live")).join(", ") || "none"
    })`,
  );
}
