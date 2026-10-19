import env from "../config/env";
import { activeEnv, gatewayConfigured, institutions, PaymentEnv, transfer, walletReady } from "./paymentGateway";

// ---------------------------------------------------------------------------
// PayMongo Disbursements: owner payouts, through the payment gateway (P2).
//
// D-21 corrected 2026-10-19: the old code here called a non-existent
// `/v2/transfers/receiving_institutions` (that 404 was read as "Disbursements
// not enabled"). The gateway uses the documented paths and REQUIRES a source
// wallet (PayMongo does), configured on Render, not here.
//
// A transfer is sent automatically only when ALL hold (canAutoPayout):
//  - new payments are live on that same gateway (not the MANUAL kill switch,
//    and the rental was paid through the gateway that is active now: a payout
//    for a sandbox payment after a switch to live would pay real money for a
//    simulated one);
//  - the gateway reports walletReady === true (GET /status).
// Otherwise the payout is recorded PENDING for staff (the same "staff pay out"
// rail damage compensation already uses), never "COMPLETED" without money.
// ---------------------------------------------------------------------------

export type TransferRail = "instapay" | "pesonet";

export interface ReceivingInstitution {
  providerCode: string;
  name: string;
}

/** The gateway to read reference data (the bank list) from: the configured one, even under MANUAL. */
function referenceEnv(): PaymentEnv | null {
  const g = env.PAYMENT_GATEWAY;
  if ((g === "sandbox" || g === "live") && gatewayConfigured(g)) return g;
  return null;
}

/** Banks/e-wallets that can receive a transfer over the rail. Empty when no gateway is configured. */
export async function listReceivingInstitutions(provider: TransferRail): Promise<ReceivingInstitution[]> {
  const e = referenceEnv();
  if (!e) return [];
  return institutions(e, provider);
}

/**
 * May a payout for a rental paid through gateway `paidVia` be sent
 * automatically right now? See the file header.
 */
export async function canAutoPayout(paidVia: PaymentEnv | null): Promise<boolean> {
  if (!paidVia || activeEnv() !== paidVia) return false;
  return walletReady(paidVia);
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

/** Sends one real-money transfer through gateway `e`. Throws on any failure: never treat a throw as success. */
export async function createTransfer(e: PaymentEnv, params: CreateTransferParams): Promise<TransferResult> {
  return transfer(e, {
    provider: params.provider,
    amount: params.amount,
    purpose: params.purpose,
    referenceNumber: params.referenceNumber,
    destination: {
      number: params.destinationAccountNumber,
      name: params.destinationAccountName,
      bic: params.destinationBic,
    },
  });
}
