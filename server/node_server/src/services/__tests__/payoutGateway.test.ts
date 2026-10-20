import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * P2.5 (SPEC-PAYMENT-GATEWAY.md §3.3, D4): owner payouts go through the
 * gateway, and only automatically while it reports a PayMongo wallet; otherwise
 * staff pay out (PENDING), never "COMPLETED" without money. Runs the REAL
 * settlement, payout and gateway code; only HTTP and the DB are mocked. Each
 * guard was removed once and a test here failed (PROGRESS.md P2 mutation log).
 */

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("axios");
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../../controllers/paymentController", () => ({ createRefund: jest.fn() }));
jest.mock("../../utils/crypto", () => ({ decryptJson: () => "09171234567", isEncryptedBlob: () => true }));

import axios from "axios";
import prisma from "../../config/database";
import env from "../../config/env";
import { finalizeRentalCompletion } from "../rentalSettlementService";
import { listReceivingInstitutions } from "../payoutService";

const db = prisma as unknown as DeepMockProxy<PrismaClient>;
const ax = axios as jest.Mocked<typeof axios>;
const E = env as any;
const KEYS = ["PAYMENT_MODE", "PAYMENT_GATEWAY", "PAYMENT_GATEWAY_SANDBOX_URL", "PAYMENT_GATEWAY_SANDBOX_TOKEN", "PAYMENT_GATEWAY_LIVE_URL", "PAYMENT_GATEWAY_LIVE_TOKEN"];
const saved: Record<string, unknown> = {};

const RENT_SANDBOX = { id: "t-pay", type: "RENTAL_PAYMENT", amount: 90, paymongoPaymentId: "pay_1", paymongoCheckoutId: "cs_1", paymentEnv: "sandbox" };
const RENT_MANUAL = { id: "t-pay", type: "RENTAL_PAYMENT", amount: 90, paymongoPaymentId: null, paymongoCheckoutId: null, paymentEnv: null };

function rental(transactions: object[]) {
  return {
    id: "r1",
    renterId: "renter-1",
    ownerId: "owner-1",
    item: { title: "Calculator" },
    renter: { id: "renter-1", email: "r@x", firstName: "R" },
    owner: {
      id: "owner-1", email: "o@x", firstName: "O",
      payoutProvider: "instapay", payoutBic: "GXCHPHM2XXX", payoutInstitutionName: "GCash", payoutAccountName: "Owner O", payoutAccountNumber: { enc: true },
    },
    transactions,
  };
}

/** Route the mocked gateway: GET /status -> walletReady; GET /health -> transfersConfigured; POST /transfers -> a transfer. */
function gateway(walletReady: boolean | null, transfersConfigured = true) {
  ax.get.mockResolvedValue({ data: { mode: "sandbox", keyMode: "test", transfersConfigured } } as never);
  ax.request.mockImplementation((async (cfg: any) => {
    if (cfg.url.endsWith("/status")) return { data: { mode: "x", walletReady } };
    if (cfg.url.endsWith("/transfers")) return { data: { transferId: "tr_1", status: "pending" } };
    throw new Error(`unexpected ${cfg.url}`);
  }) as never);
}
const urls = () => ax.request.mock.calls.map((c) => (c[0] as any).url as string);
const payout = () =>
  db.transaction.create.mock.calls.map((c) => (c[0] as any).data).find((d: any) => d.type === "OWNER_PAYOUT") as
    | { status: string; paymentMethod: string; amount: number }
    | undefined;

beforeEach(() => {
  for (const k of KEYS) saved[k] = E[k];
  mockReset(db);
  db.$transaction.mockImplementation((async (ops: unknown) => ops) as never);
  ax.request.mockReset();
  ax.get.mockReset();
  E.PAYMENT_MODE = "PAYMONGO";
  E.PAYMENT_GATEWAY = "sandbox";
  E.PAYMENT_GATEWAY_SANDBOX_URL = "https://pay-sandbox.example";
  E.PAYMENT_GATEWAY_SANDBOX_TOKEN = "s".repeat(40);
  E.PAYMENT_GATEWAY_LIVE_URL = "https://pay-live.example";
  E.PAYMENT_GATEWAY_LIVE_TOKEN = "l".repeat(40);
});
afterEach(() => {
  for (const k of KEYS) E[k] = saved[k];
});

describe("owner payout through the gateway", () => {
  it("wallet ready, rent paid through the active gateway: a transfer on THAT gateway, recorded sent", async () => {
    gateway(true);
    db.rental.findUnique.mockResolvedValue(rental([RENT_SANDBOX]) as never);
    await finalizeRentalCompletion("r1");
    expect(urls()).toContain("https://pay-sandbox.example/transfers");
    const body = (ax.request.mock.calls.find((c) => (c[0] as any).url.endsWith("/transfers"))![0] as any).data;
    expect(body).toMatchObject({ provider: "instapay", amount: 90, destination: { number: "09171234567", name: "Owner O", bic: "GXCHPHM2XXX" } });
    expect(payout()).toMatchObject({ status: "COMPLETED", paymentMethod: "PayMongo Disbursement" });
  });

  it("no PayMongo wallet yet (walletReady false): no transfer; PENDING for staff, never COMPLETED", async () => {
    gateway(false);
    db.rental.findUnique.mockResolvedValue(rental([RENT_SANDBOX]) as never);
    await finalizeRentalCompletion("r1");
    expect(urls().some((u) => u.endsWith("/transfers"))).toBe(false);
    expect(payout()).toMatchObject({ status: "PENDING", amount: 90 });
    expect(payout()!.paymentMethod).toMatch(/staff pay out/);
  });

  it("a wallet but no source account on the gateway: no transfer, PENDING for staff (the live account on 2026-10-21)", async () => {
    gateway(true, false);
    db.rental.findUnique.mockResolvedValue(rental([RENT_SANDBOX]) as never);
    await finalizeRentalCompletion("r1");
    expect(urls().some((u) => u.endsWith("/transfers"))).toBe(false);
    expect(payout()).toMatchObject({ status: "PENDING" });
    expect(payout()!.paymentMethod).toMatch(/staff pay out/);
  });

  it("walletReady unknown (null) is not ready", async () => {
    gateway(null);
    db.rental.findUnique.mockResolvedValue(rental([RENT_SANDBOX]) as never);
    await finalizeRentalCompletion("r1");
    expect(urls().some((u) => u.endsWith("/transfers"))).toBe(false);
    expect(payout()!.status).toBe("PENDING");
  });

  it("under the MANUAL kill switch: no automatic transfer, not even a /status call", async () => {
    E.PAYMENT_MODE = "MANUAL";
    gateway(true);
    db.rental.findUnique.mockResolvedValue(rental([RENT_SANDBOX]) as never);
    await finalizeRentalCompletion("r1");
    expect(ax.request).not.toHaveBeenCalled();
    expect(payout()!.status).toBe("PENDING");
  });

  it("rent paid on the SANDBOX after a switch to live: no transfer, and staff are told no real money was collected", async () => {
    E.PAYMENT_GATEWAY = "live";
    gateway(true);
    db.rental.findUnique.mockResolvedValue(rental([RENT_SANDBOX]) as never);
    await finalizeRentalCompletion("r1");
    expect(urls().some((u) => u.endsWith("/transfers"))).toBe(false);
    expect(payout()!.status).toBe("PENDING");
    expect(payout()!.paymentMethod).toMatch(/TEST payment: no real money was collected/);
  });

  it("rent paid manually (GCash): staff pay out, no gateway call", async () => {
    gateway(true);
    db.rental.findUnique.mockResolvedValue(rental([RENT_MANUAL]) as never);
    await finalizeRentalCompletion("r1");
    expect(ax.request).not.toHaveBeenCalled();
    expect(payout()).toMatchObject({ status: "PENDING", paymentMethod: "Rental payout (staff pay out)" });
    const titles = db.notification.create.mock.calls.map((c) => (c[0] as any).data.title);
    expect(titles).toContain("Rental payout on its way");
  });

  it("a transfer the gateway refuses: FAILED, owner told, never COMPLETED", async () => {
    ax.request.mockImplementation((async (cfg: any) => {
      if (cfg.url.endsWith("/status")) return { data: { walletReady: true } };
      throw { response: { status: 409 } };
    }) as never);
    ax.get.mockResolvedValue({ data: { transfersConfigured: true } } as never);
    db.rental.findUnique.mockResolvedValue(rental([RENT_SANDBOX]) as never);
    await finalizeRentalCompletion("r1");
    expect(payout()!.status).toBe("FAILED");
  });
});

describe("listReceivingInstitutions", () => {
  it("reads the bank list from the configured gateway, even under MANUAL", async () => {
    E.PAYMENT_MODE = "MANUAL";
    ax.request.mockResolvedValue({ data: { data: [{ providerCode: "GXCHPHM2XXX", name: "GCash" }] } });
    await expect(listReceivingInstitutions("instapay")).resolves.toEqual([{ providerCode: "GXCHPHM2XXX", name: "GCash" }]);
    expect(urls()[0]).toBe("https://pay-sandbox.example/transfers/institutions?provider=instapay");
  });
  it("empty, with no call, when no gateway is configured", async () => {
    E.PAYMENT_GATEWAY_SANDBOX_URL = "";
    await expect(listReceivingInstitutions("instapay")).resolves.toEqual([]);
    expect(ax.request).not.toHaveBeenCalled();
  });
});
