import axios, { AxiosInstance } from "axios";
import type { SourceAccount } from "./config";

/**
 * Every PayMongo call the platform makes, in one place. Amounts cross this
 * boundary in PESOS and are converted to centavos here, exactly as the main
 * API did before (paymongoService.createCheckoutSession, createRefund,
 * payoutService.createTransfer all used Math.round(amount * 100)).
 *
 * Disbursement paths follow PayMongo's reference (checked 2026-10-19), NOT the
 * main API's old code, which called a non-existent
 * `/v2/transfers/receiving_institutions` (the real cause of D-21):
 *   GET  /v1/wallets/receiving_institutions?provider=instapay|pesonet
 *   POST /v2/batch_transfers   (source_account is REQUIRED)
 *   GET  /v1/wallets
 */

export type CheckoutState = "paid" | "expired" | "open";

export interface CheckoutInfo {
  state: CheckoutState;
  /** Amount of the checkout's line items, in pesos (for the main API's amount check). */
  amount: number;
  paymentId?: string;
  referenceNo?: string;
  livemode: boolean;
}

export interface Institution {
  providerCode: string;
  name: string;
}

export interface PayMongo {
  createCheckout(p: {
    amount: number;
    name: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ checkoutUrl: string; checkoutId: string }>;
  getCheckout(id: string): Promise<CheckoutInfo>;
  expireCheckout(id: string): Promise<void>;
  refund(p: { paymentId: string; amount: number; reason: string }): Promise<{ refundId: string; status: string }>;
  institutions(provider: "instapay" | "pesonet"): Promise<Institution[]>;
  transfer(p: {
    source: SourceAccount;
    provider: "instapay" | "pesonet";
    amount: number;
    destination: { number: string; name: string; bic: string };
    referenceNumber: string;
    purpose: string;
  }): Promise<{ transferId: string; status: string }>;
  walletReady(): Promise<boolean>;
}

export const toCentavos = (pesos: number) => Math.round(pesos * 100);

export function createPayMongo(secretKey: string, http?: AxiosInstance): PayMongo {
  const client =
    http ??
    axios.create({
      baseURL: "https://api.paymongo.com",
      timeout: 15_000,
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
    });

  return {
    async createCheckout(p) {
      const { data } = await client.post("/v1/checkout_sessions", {
        data: {
          attributes: {
            billing: { name: "EngiRent Hub Student" },
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            line_items: [{ currency: "PHP", amount: toCentavos(p.amount), description: p.description, name: p.name, quantity: 1 }],
            // QR Ph is active by default once a live account is activated; the
            // others appear only when PayMongo shows them Active (Settings ->
            // Payment Methods). Without "qrph" a newly activated live account
            // showed "No payment methods are available" (2026-10-21).
            payment_method_types: ["qrph", "gcash", "paymaya", "card", "brankas_bdo"],
            description: p.description,
            success_url: p.successUrl,
            cancel_url: p.cancelUrl,
            metadata: p.metadata,
          },
        },
      });
      return { checkoutUrl: data.data.attributes.checkout_url as string, checkoutId: data.data.id as string };
    },

    async getCheckout(id) {
      const { data } = await client.get(`/v1/checkout_sessions/${encodeURIComponent(id)}`);
      const attrs = data?.data?.attributes ?? {};
      const items: Array<{ amount?: number; quantity?: number }> = attrs.line_items ?? [];
      const amount = items.reduce((sum, li) => sum + (li.amount ?? 0) * (li.quantity ?? 1), 0) / 100;
      const payments: Array<{ id?: string; attributes?: { status?: string } }> = attrs.payments ?? [];
      const paid = payments.find((p) => p?.attributes?.status === "paid");
      const intentStatus = attrs.payment_intent?.attributes?.status;
      const livemode = Boolean(attrs.livemode);
      if (paid || intentStatus === "succeeded") {
        return { state: "paid", amount, paymentId: paid?.id ?? attrs.payment_intent?.id, referenceNo: attrs.reference_number, livemode };
      }
      if (attrs.status === "expired") return { state: "expired", amount, livemode };
      return { state: "open", amount, livemode };
    },

    async expireCheckout(id) {
      await client.post(`/v1/checkout_sessions/${encodeURIComponent(id)}/expire`, {});
    },

    async refund(p) {
      const { data } = await client.post("/v1/refunds", {
        data: { attributes: { amount: toCentavos(p.amount), payment_id: p.paymentId, reason: p.reason, notes: "EngiRent Hub refund" } },
      });
      return { refundId: data.data.id as string, status: (data.data.attributes?.status as string) ?? "pending" };
    },

    async institutions(provider) {
      const { data } = await client.get("/v1/wallets/receiving_institutions", { params: { provider } });
      const rows: Array<{ attributes?: { name?: string; provider_code?: string } }> = data?.data ?? [];
      return rows
        .map((r) => ({ providerCode: r.attributes?.provider_code ?? "", name: r.attributes?.name ?? "" }))
        .filter((r) => r.providerCode && r.name);
    },

    async transfer(p) {
      const { data } = await client.post("/v2/batch_transfers", {
        transfers: [
          {
            provider: p.provider,
            amount: toCentavos(p.amount),
            currency: "PHP",
            purpose: p.purpose,
            reference_number: p.referenceNumber,
            source_account: p.source,
            destination_account: p.destination,
          },
        ],
      });
      const t = data?.data?.transfers?.[0];
      if (!t?.id) throw new Error("PayMongo transfer response had no transfer id");
      return { transferId: t.id as string, status: t.status as string };
    },

    async walletReady() {
      const { data } = await client.get("/v1/wallets");
      const d = data?.data;
      return Array.isArray(d) ? d.length > 0 : Boolean(d);
    },
  };
}
