/**
 * Configuration and the mode interlocks (SPEC-PAYMENT-GATEWAY.md §3.1).
 *
 * One gateway runs per mode. A gateway that is misconfigured REFUSES TO START
 * rather than running with the wrong kind of money:
 *  - sandbox needs an `sk_test_` key;
 *  - live needs an `sk_live_` key AND `ALLOW_LIVE=yes`;
 *  - every mode needs a GATEWAY_TOKEN of at least 32 characters (the shared
 *    secret with the main API; the gateway's URL is public).
 * Secrets are never logged or returned; only their presence is reported.
 */

export type PaymentEnv = "sandbox" | "live";

export interface SourceAccount {
  number: string;
  name: string;
  bic: string;
}

export interface Config {
  env: PaymentEnv;
  paymongoSecretKey: string;
  /** Empty until the webhook is registered in PayMongo (hosting guide 8.4); the webhook answers 503 until then. */
  webhookSecret: string;
  gatewayToken: string;
  /** Raw URL of the endpoint gist; its `api` field is the main API's current base (ends in /api/v1). */
  endpointGistUrl: string;
  /** Optional fixed main API base, used instead of the gist (local testing). */
  mainApiUrl: string;
  /** The platform's PayMongo wallet; transfers are refused without it (PayMongo requires a source account). */
  sourceAccount: SourceAccount | null;
  port: number;
}

export class ConfigError extends Error {}

/** PayMongo's BIC for its own wallets (docs: create-batch-transfer, source_account.bic). */
export const PAYMONGO_WALLET_BIC = "PAEYPHM2XXX";

export function loadConfig(e: NodeJS.ProcessEnv): Config {
  const env = (e.PAYMENT_ENV ?? "").trim();
  if (env !== "sandbox" && env !== "live") {
    throw new ConfigError(`PAYMENT_ENV must be "sandbox" or "live" (got ${env ? JSON.stringify(env) : "nothing"})`);
  }

  const key = (e.PAYMONGO_SECRET_KEY ?? "").trim();
  if (env === "sandbox" && !key.startsWith("sk_test_")) {
    throw new ConfigError("The sandbox gateway needs a TEST secret key (sk_test_...). Refusing to start.");
  }
  if (env === "live") {
    if (!key.startsWith("sk_live_")) {
      throw new ConfigError("The live gateway needs a LIVE secret key (sk_live_...). Refusing to start.");
    }
    if ((e.ALLOW_LIVE ?? "").trim() !== "yes") {
      throw new ConfigError("The live gateway moves real money: set ALLOW_LIVE=yes to start it. Refusing to start.");
    }
  }

  const token = (e.GATEWAY_TOKEN ?? "").trim();
  if (token.length < 32) {
    throw new ConfigError("GATEWAY_TOKEN must be at least 32 characters (it is the only thing protecting this public URL).");
  }

  const gist = (e.ENDPOINT_GIST_URL ?? "").trim();
  const mainApi = (e.MAIN_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!gist && !mainApi) {
    throw new ConfigError("Set ENDPOINT_GIST_URL (or MAIN_API_URL) so webhook events can reach the main API.");
  }

  const srcNumber = (e.PAYMONGO_SOURCE_ACCOUNT_NUMBER ?? "").trim();
  const srcName = (e.PAYMONGO_SOURCE_ACCOUNT_NAME ?? "").trim();

  const port = Number(e.PORT ?? 10000);
  return {
    env,
    paymongoSecretKey: key,
    webhookSecret: (e.PAYMONGO_WEBHOOK_SECRET ?? "").trim(),
    gatewayToken: token,
    endpointGistUrl: gist,
    mainApiUrl: mainApi,
    sourceAccount: srcNumber && srcName ? { number: srcNumber, name: srcName, bic: PAYMONGO_WALLET_BIC } : null,
    port: Number.isFinite(port) && port > 0 ? port : 10000,
  };
}
