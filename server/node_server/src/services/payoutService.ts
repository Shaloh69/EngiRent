import axios from "axios";
import env from "../config/env";
import logger from "../utils/logger";

// ---------------------------------------------------------------------------
// PayMongo Disbursements (Transfers V2) — moves real money OUT of the
// platform's PayMongo Wallet to an item owner's bank account or e-wallet.
// Distinct from the v1 Checkout/Refund API used elsewhere in paymentController
// — Disbursements is a separate product on a separate API version
// (api.paymongo.com/v2), documented at https://docs.paymongo.com/docs/money-movement-quick-start.
//
// Response/field shapes here are based on PayMongo's published docs, not a
// live sandbox call (no real secret key was available while writing this) —
// Phase 4's live audit must run a real sandbox transfer and correct anything
// that doesn't match before this is trusted with real money.
// ---------------------------------------------------------------------------

const PAYMONGO_V2_BASE = "https://api.paymongo.com/v2";

function paymongoAuth(): string {
  const key = env.PAYMONGO_SECRET_KEY ?? "";
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

export type TransferRail = "instapay" | "pesonet";

export interface ReceivingInstitution {
  providerCode: string;
  name: string;
}

/** Lists banks/e-wallets that can receive a Transfer over the given rail —
 * used to populate the payout-destination picker rather than hardcoding
 * provider codes we can't verify without live API access. */
export async function listReceivingInstitutions(
  provider: TransferRail,
): Promise<ReceivingInstitution[]> {
  const { data } = await axios.get(
    `${PAYMONGO_V2_BASE}/transfers/receiving_institutions`,
    {
      params: { provider },
      headers: { Authorization: paymongoAuth() },
    },
  );

  // Defensive parsing — the exact response shape isn't confirmed from docs
  // alone (see file header). Accept the couple of shapes that would be
  // reasonable for a PayMongo `data: [...]` list response.
  const rows: unknown[] = Array.isArray(data?.data) ? data.data : [];
  return rows
    .map((row): ReceivingInstitution | null => {
      const attrs = (row as Record<string, unknown>)?.attributes ?? row;
      const a = attrs as Record<string, unknown>;
      const providerCode = (a.provider_code ?? a.code ?? a.bic) as
        | string
        | undefined;
      const name = (a.name ?? a.institution_name ?? a.display_name) as
        | string
        | undefined;
      if (!providerCode || !name) return null;
      return { providerCode, name };
    })
    .filter((x): x is ReceivingInstitution => x !== null);
}

export interface CreateTransferParams {
  amount: number; // PHP
  provider: TransferRail;
  purpose: string;
  referenceNumber: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  destinationBic: string;
}

export interface TransferResult {
  transferId: string;
  status: string;
}

/** Sends a single real-money Transfer (owner payout) via PayMongo Disbursements.
 * Throws on any failure — callers must not treat a thrown error as success. */
export async function createTransfer(
  params: CreateTransferParams,
): Promise<TransferResult> {
  const sourceAccount =
    env.PAYMONGO_SOURCE_ACCOUNT_NUMBER &&
    env.PAYMONGO_SOURCE_ACCOUNT_NAME &&
    env.PAYMONGO_SOURCE_ACCOUNT_BIC
      ? {
          number: env.PAYMONGO_SOURCE_ACCOUNT_NUMBER,
          name: env.PAYMONGO_SOURCE_ACCOUNT_NAME,
          bic: env.PAYMONGO_SOURCE_ACCOUNT_BIC,
        }
      : undefined;

  const { data } = await axios.post(
    `${PAYMONGO_V2_BASE}/batch_transfers`,
    {
      transfers: [
        {
          provider: params.provider,
          amount: Math.round(params.amount * 100), // centavos
          currency: "PHP",
          purpose: params.purpose,
          reference_number: params.referenceNumber,
          ...(sourceAccount && { source_account: sourceAccount }),
          destination_account: {
            number: params.destinationAccountNumber,
            name: params.destinationAccountName,
            bic: params.destinationBic,
          },
        },
      ],
    },
    {
      headers: {
        Authorization: paymongoAuth(),
        "Content-Type": "application/json",
      },
    },
  );

  const transfer = data?.data?.transfers?.[0];
  if (!transfer?.id) {
    logger.error("PayMongo transfer response missing expected shape:", data);
    throw new Error("PayMongo transfer did not return a transfer id");
  }

  return { transferId: transfer.id as string, status: transfer.status as string };
}
