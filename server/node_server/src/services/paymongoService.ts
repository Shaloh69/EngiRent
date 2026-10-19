import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import {
  activeEnv,
  assertGatewayMode,
  createCheckout,
  envOf,
  expireCheckout,
  gatewayConfigured,
  getCheckout,
  PaymentEnv,
  sameAmount,
  type CheckoutState,
} from "./paymentGateway";
import { markTransactionPaid, markTransactionFailed, ConfirmVia } from "./paymentConfirmationService";

/**
 * PayMongo checkout sessions, as the rest of the API sees them.
 *
 * User ruling 2026-10-11 (Dispute v2, ruling 6, extended to ALL payments):
 * PayMongo is the PRIMARY way to pay and manual admin confirmation is the
 * FALLBACK when PayMongo is unavailable.
 *
 * Since P2 (SPEC-PAYMENT-GATEWAY.md) nothing here talks to PayMongo directly:
 * every call goes through the payment gateway on Render, which holds the key.
 * The confirmation still does NOT depend on the webhook: the poller asks the
 * gateway (paymentPoller.ts), and a webhook forwarded by the gateway
 * (POST /payments/gateway-event) only makes it faster. Both end in
 * confirmFromCheckout below, which never trusts anything but PayMongo's own
 * answer for the transaction's own gateway.
 */

export type { CheckoutState };

/** True when NEW payments are created through a gateway (not MANUAL, gateway configured). */
export function paymongoConfigured(): boolean {
  return activeEnv() !== null;
}

/** True when new payments are simulated: the active gateway is the sandbox. */
export function paymongoIsTestMode(): boolean {
  return activeEnv() === "sandbox";
}

/**
 * Create a checkout on the active gateway, after checking that the gateway
 * really is that mode (fails closed on a mismatch). Throws GatewayWaking when
 * it is asleep, GatewayUnavailable when it is wrong or missing.
 */
export async function createCheckoutSession(params: {
  amount: number; // PHP; the gateway converts to centavos
  name: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ checkoutUrl: string; checkoutId: string; paymentEnv: PaymentEnv }> {
  const e = activeEnv();
  if (!e) throw new Error("No payment gateway is active (PAYMENT_MODE=MANUAL or PAYMENT_GATEWAY unset)");
  await assertGatewayMode(e);
  const out = await createCheckout(e, params);
  return { ...out, paymentEnv: e };
}

/** Ask the transaction's own gateway what happened to its checkout. Throws on a network error. */
export async function retrieveCheckoutSession(e: PaymentEnv, checkoutId: string): Promise<CheckoutState> {
  return getCheckout(e, checkoutId);
}

/** Close a checkout so it can no longer be paid (a kiosk visit timed out). */
export async function expireCheckoutSession(e: PaymentEnv, checkoutId: string): Promise<void> {
  await expireCheckout(e, checkoutId);
}

export type CheckoutOutcome = "paid" | "expired" | "open" | "skip" | "amount_mismatch";

/**
 * THE confirmation rule for a gateway payment, used by the poller and by the
 * forwarded webhook alike (SPEC §6: "never trust a forwarded paid on its own"):
 * ask the transaction's OWN gateway, and mark it paid only if PayMongo says
 * paid for exactly the transaction's amount. Idempotent (markTransactionPaid).
 */
export async function confirmFromCheckout(io: Server | undefined, transactionId: string, via: ConfirmVia): Promise<CheckoutOutcome> {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx?.paymongoCheckoutId || !(tx.status === "PENDING" || tx.status === "PROCESSING")) return "skip";
  const e = envOf(tx);
  if (!e || !gatewayConfigured(e)) return "skip";
  const state = await getCheckout(e, tx.paymongoCheckoutId);
  if (state.state === "paid") {
    if (!sameAmount(state.amount, tx.amount)) {
      logger.error(
        `[PAYMENT] ${tx.id}: PayMongo says checkout ${tx.paymongoCheckoutId} was paid ₱${state.amount}, but the transaction is ₱${tx.amount}. NOT confirmed; an admin must look.`,
      );
      return "amount_mismatch";
    }
    await markTransactionPaid(io, tx.id, { via, paymentId: state.paymentId, referenceNo: state.referenceNo });
    return "paid";
  }
  if (state.state === "expired") {
    await markTransactionFailed(io, tx.id, { via: "CHECKOUT_EXPIRED", reason: "the PayMongo checkout expired" });
    return "expired";
  }
  return "open";
}
