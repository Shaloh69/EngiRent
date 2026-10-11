import axios from "axios";
import env from "../config/env";

/**
 * PayMongo checkout sessions — one place for every call this server makes.
 *
 * User ruling 2026-10-11 (Dispute v2, ruling 6, extended to ALL payments):
 * PayMongo is the PRIMARY way to pay and manual admin confirmation is the
 * FALLBACK when PayMongo is unavailable. The 2026-09-06 "manual for the time
 * being" ruling is superseded.
 *
 * The confirmation does NOT depend on the webhook. The webhook still works when
 * PayMongo can reach this server, but the API sits behind a Cloudflare quick
 * tunnel whose hostname changes on every restart, and the registered webhook
 * points at a dead host. So the server asks PayMongo itself
 * (`retrieveCheckoutSession`) while a payment is pending: see paymentPoller.ts.
 */

const PAYMONGO_BASE = "https://api.paymongo.com/v1";

export function paymongoConfigured(): boolean {
  return Boolean(env.PAYMONGO_SECRET_KEY) && env.PAYMENT_MODE !== "MANUAL";
}

/** True when the installed key is a TEST key: payments are simulated, no real money moves. */
export function paymongoIsTestMode(): boolean {
  return (env.PAYMONGO_SECRET_KEY ?? "").startsWith("sk_test_");
}

function auth() {
  const key = env.PAYMONGO_SECRET_KEY ?? "";
  return {
    Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

export async function createCheckoutSession(params: {
  amount: number; // PHP; converted to centavos
  name: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
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
              amount: Math.round(params.amount * 100),
              description: params.description,
              name: params.name,
              quantity: 1,
            },
          ],
          payment_method_types: ["gcash", "paymaya", "card", "brankas_bdo"],
          description: params.description,
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          metadata: params.metadata,
        },
      },
    },
    { headers: auth(), timeout: 15_000 },
  );
  return {
    checkoutUrl: data.data.attributes.checkout_url as string,
    checkoutId: data.data.id as string,
  };
}

export interface CheckoutState {
  /** "paid" once a payment on the session succeeded; "expired" once PayMongo
   *  closed it; otherwise "open". */
  state: "paid" | "expired" | "open";
  paymentId?: string;
  referenceNo?: string;
}

/** Ask PayMongo what happened to a checkout session. Throws on a network error. */
export async function retrieveCheckoutSession(checkoutId: string): Promise<CheckoutState> {
  const { data } = await axios.get(`${PAYMONGO_BASE}/checkout_sessions/${checkoutId}`, {
    headers: auth(),
    timeout: 10_000,
  });
  const attrs = data?.data?.attributes ?? {};
  const payments: Array<{ id?: string; attributes?: { status?: string } }> = attrs.payments ?? [];
  const paid = payments.find((p) => p?.attributes?.status === "paid");
  const intentStatus = attrs.payment_intent?.attributes?.status;
  if (paid || intentStatus === "succeeded") {
    return {
      state: "paid",
      paymentId: paid?.id ?? attrs.payment_intent?.id,
      referenceNo: attrs.reference_number,
    };
  }
  if (attrs.status === "expired") return { state: "expired" };
  return { state: "open" };
}

/** Close a checkout so it can no longer be paid (a kiosk visit timed out). */
export async function expireCheckoutSession(checkoutId: string): Promise<void> {
  await axios.post(`${PAYMONGO_BASE}/checkout_sessions/${checkoutId}/expire`, {}, {
    headers: auth(),
    timeout: 10_000,
  });
}
