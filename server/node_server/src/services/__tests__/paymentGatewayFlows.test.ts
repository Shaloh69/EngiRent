import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

// P2.3 (SPEC-PAYMENT-GATEWAY.md §3.2, §6, D2): the confirm rule shared by the
// poller and the forwarded webhook, and the kiosk dispute fee's wait for a
// waking gateway. Each guard was removed once and a test here failed
// (PROGRESS.md P2 mutation log).

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("axios");
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../paymentConfirmationService", () => ({
  markTransactionPaid: jest.fn().mockResolvedValue({ status: "confirmed" }),
  markTransactionFailed: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../adminRoom", () => ({ notifyAdmins: jest.fn() }));
jest.mock("../kioskBayAccessStore", () => ({ grantBayAccess: jest.fn() }));
jest.mock("../faceVerificationService", () => ({ assignLocker: jest.fn() }));
jest.mock("../disputeWrongItemService", () => ({ baysHoldingWrongItems: jest.fn().mockResolvedValue([]) }));
jest.mock("../disputeEvents", () => ({ recordEvent: jest.fn(), tellParty: jest.fn() }));
jest.mock("../disputeService", () => ({
  disputeMoney: jest.fn().mockResolvedValue({ owed: 300 }),
  freezeFees: jest.fn(),
  resumeFees: jest.fn(),
  RENTER_ACTION_STATUSES: ["OPEN", "PAYMENT_PENDING"],
}));

import axios from "axios";
import prisma from "../../config/database";
import env from "../../config/env";
import { markTransactionFailed, markTransactionPaid } from "../paymentConfirmationService";
import { confirmFromCheckout, createCheckoutSession } from "../paymongoService";
import { _clearVisits, createDisputePayment, endVisit, GATEWAY_WAIT_MS, startDisputeVisit } from "../disputeKioskService";
import { GatewayWaking } from "../paymentGateway";
import { _sweepOnce } from "../paymentPoller";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const ax = axios as jest.Mocked<typeof axios>;
const E = env as any;
const KEYS = ["PAYMENT_MODE", "PAYMENT_GATEWAY", "PAYMENT_GATEWAY_SANDBOX_URL", "PAYMENT_GATEWAY_SANDBOX_TOKEN", "PAYMENT_GATEWAY_LIVE_URL", "PAYMENT_GATEWAY_LIVE_TOKEN"];
const saved: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = E[k];
  mockReset(prismaMock);
  ax.get.mockReset();
  ax.request.mockReset();
  (markTransactionPaid as jest.Mock).mockClear();
  (markTransactionFailed as jest.Mock).mockClear();
  E.PAYMENT_MODE = "PAYMONGO";
  E.PAYMENT_GATEWAY = "live";
  E.PAYMENT_GATEWAY_SANDBOX_URL = "https://pay-sandbox.example";
  E.PAYMENT_GATEWAY_SANDBOX_TOKEN = "s".repeat(40);
  E.PAYMENT_GATEWAY_LIVE_URL = "https://pay-live.example";
  E.PAYMENT_GATEWAY_LIVE_TOKEN = "l".repeat(40);
});
afterEach(() => {
  for (const k of KEYS) E[k] = saved[k];
  _clearVisits();
  jest.restoreAllMocks();
});

const pendingTx = (over: Record<string, unknown> = {}) =>
  ({ id: "tx-1", status: "PENDING", amount: 400, paymongoCheckoutId: "cs_1", paymentEnv: "sandbox", ...over }) as never;
const checkoutSays = (data: Record<string, unknown>) => ax.request.mockResolvedValue({ data: { livemode: false, ...data } });

describe("confirmFromCheckout: PayMongo's own answer, on the transaction's own gateway", () => {
  it("paid for the same amount -> confirmed, asked on the SANDBOX gateway although live is active", async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx());
    checkoutSays({ state: "paid", amount: 400, paymentId: "pay_1", referenceNo: "R1" });
    await expect(confirmFromCheckout(undefined, "tx-1", "PAYMONGO_POLL")).resolves.toBe("paid");
    expect((ax.request.mock.calls[0][0] as any).url).toBe("https://pay-sandbox.example/checkouts/cs_1");
    expect(markTransactionPaid).toHaveBeenCalledWith(undefined, "tx-1", { via: "PAYMONGO_POLL", paymentId: "pay_1", referenceNo: "R1" });
  });
  it("a live row is asked on the live gateway", async () => {
    E.PAYMENT_GATEWAY = "sandbox";
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx({ paymentEnv: "live" }));
    checkoutSays({ state: "open", amount: 400 });
    await confirmFromCheckout(undefined, "tx-1", "PAYMONGO_POLL");
    expect((ax.request.mock.calls[0][0] as any).url).toBe("https://pay-live.example/checkouts/cs_1");
  });
  it("paid for a DIFFERENT amount -> NOT confirmed", async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx());
    checkoutSays({ state: "paid", amount: 1, paymentId: "pay_1" });
    await expect(confirmFromCheckout(undefined, "tx-1", "PAYMONGO_WEBHOOK")).resolves.toBe("amount_mismatch");
    expect(markTransactionPaid).not.toHaveBeenCalled();
  });
  it("open -> nothing happens", async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx());
    checkoutSays({ state: "open", amount: 400 });
    await expect(confirmFromCheckout(undefined, "tx-1", "PAYMONGO_POLL")).resolves.toBe("open");
    expect(markTransactionPaid).not.toHaveBeenCalled();
    expect(markTransactionFailed).not.toHaveBeenCalled();
  });
  it("expired -> marked failed", async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx());
    checkoutSays({ state: "expired", amount: 400 });
    await expect(confirmFromCheckout(undefined, "tx-1", "PAYMONGO_POLL")).resolves.toBe("expired");
    expect(markTransactionFailed).toHaveBeenCalled();
    expect(markTransactionPaid).not.toHaveBeenCalled();
  });
  it("an already completed row is not asked about", async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx({ status: "COMPLETED" }));
    await expect(confirmFromCheckout(undefined, "tx-1", "PAYMONGO_POLL")).resolves.toBe("skip");
    expect(ax.request).not.toHaveBeenCalled();
  });
  it("a row whose gateway is not configured here is skipped, never asked on another gateway", async () => {
    E.PAYMENT_GATEWAY_SANDBOX_URL = "";
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx());
    await expect(confirmFromCheckout(undefined, "tx-1", "PAYMONGO_POLL")).resolves.toBe("skip");
    expect(ax.request).not.toHaveBeenCalled();
  });
  it("still polls under the MANUAL kill switch (money already taken is not stranded)", async () => {
    E.PAYMENT_MODE = "MANUAL";
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx());
    checkoutSays({ state: "paid", amount: 400, paymentId: "pay_1" });
    await expect(confirmFromCheckout(undefined, "tx-1", "PAYMONGO_POLL")).resolves.toBe("paid");
  });
});

describe("the poller sweep", () => {
  it("keeps polling pending gateway rows under the MANUAL kill switch", async () => {
    E.PAYMENT_MODE = "MANUAL";
    prismaMock.transaction.findMany.mockResolvedValue([{ id: "tx-1", type: "RENTAL_PAYMENT", createdAt: new Date(), paymongoCheckoutId: "cs_1", paymentEnv: "sandbox", rentalId: "r-1" }] as never);
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx());
    checkoutSays({ state: "paid", amount: 400, paymentId: "pay_1" });
    await _sweepOnce({} as never);
    expect(markTransactionPaid).toHaveBeenCalled();
  });
  it("does nothing at all when no gateway is configured", async () => {
    E.PAYMENT_GATEWAY_SANDBOX_URL = "";
    E.PAYMENT_GATEWAY_LIVE_URL = "";
    await _sweepOnce({} as never);
    expect(prismaMock.transaction.findMany).not.toHaveBeenCalled();
  });
});

describe("createCheckoutSession checks the gateway's mode itself (defence behind its callers)", () => {
  const params = { amount: 400, name: "n", description: "d", successUrl: "https://x/s", cancelUrl: "https://x/c", metadata: {} };
  it("refuses, and creates nothing, when the gateway reports another mode", async () => {
    ax.get.mockResolvedValue({ data: { mode: "sandbox", keyMode: "test" } }); // PAYMENT_GATEWAY=live
    await expect(createCheckoutSession(params)).rejects.toThrow(/mismatch/);
    expect(ax.request).not.toHaveBeenCalled();
  });
  it("creates on the active gateway and says which", async () => {
    ax.get.mockResolvedValue({ data: { mode: "live", keyMode: "live" } });
    ax.request.mockResolvedValue({ data: { checkoutId: "cs_1", checkoutUrl: "https://checkout.paymongo.com/cs_1" } });
    await expect(createCheckoutSession(params)).resolves.toMatchObject({ checkoutId: "cs_1", paymentEnv: "live" });
  });
});

describe("kiosk dispute fee and a sleeping gateway (D2: 90 s, then GCash)", () => {
  const emit = jest.fn();
  const io = { to: () => ({ emit }) } as never;

  async function startVisit(at: number) {
    jest.spyOn(Date, "now").mockReturnValue(at);
    prismaMock.dispute.findFirst.mockResolvedValue({ id: "d-1", status: "OPEN", rentalId: "r-1", referenceNo: "ER-D-1" } as never);
    prismaMock.transaction.findFirst.mockResolvedValue(null as never);
    await startDisputeVisit(io, { rentalId: "r-1", userId: "u-1", kioskId: "KIOSK-001" });
    prismaMock.dispute.findUnique.mockResolvedValue({
      id: "d-1",
      renterId: "u-1",
      rentalId: "r-1",
      referenceNo: "ER-D-1",
      rental: { item: { title: "Calculator" } },
    } as never);
    prismaMock.transaction.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "tx-9", ...data }) as never);
    prismaMock.transaction.update.mockImplementation(({ data }: any) => Promise.resolve({ id: "tx-9", amount: 300, ...data }) as never);
  }

  it("the visit start wakes the active gateway", async () => {
    ax.get.mockReturnValue(new Promise(() => undefined) as never);
    await startVisit(1_000_000);
    expect(ax.get).toHaveBeenCalledWith("https://pay-live.example/health", expect.anything());
  });

  it("within 90 s of the visit: 'Connecting…', and no payment recorded", async () => {
    await startVisit(1_000_000);
    ax.get.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    jest.spyOn(Date, "now").mockReturnValue(1_000_000 + GATEWAY_WAIT_MS - 1000);
    await expect(createDisputePayment(io, { disputeId: "d-1", userId: "u-1" })).rejects.toBeInstanceOf(GatewayWaking);
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("after 90 s still asleep: the manual GCash fallback", async () => {
    await startVisit(1_000_000);
    ax.get.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    jest.spyOn(Date, "now").mockReturnValue(1_000_000 + GATEWAY_WAIT_MS + 1000);
    const out = await createDisputePayment(io, { disputeId: "d-1", userId: "u-1" });
    expect(out.paymentMode).toBe("MANUAL");
    expect(ax.request).not.toHaveBeenCalled();
  });

  it("an awake gateway: a checkout on it, paymentEnv stamped", async () => {
    await startVisit(1_000_000);
    ax.get.mockResolvedValue({ data: { mode: "live", keyMode: "live" } });
    ax.request.mockResolvedValue({ data: { checkoutId: "cs_9", checkoutUrl: "https://checkout.paymongo.com/cs_9" } });
    const out = await createDisputePayment(io, { disputeId: "d-1", userId: "u-1" });
    expect(out.paymentMode).toBe("PAYMONGO");
    expect(out.testMode).toBe(false);
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymongoCheckoutId: "cs_9", paymentEnv: "live" }) }),
    );
  });

  it("a wrong-mode gateway: manual at once, no checkout (fail closed)", async () => {
    await startVisit(1_000_000);
    ax.get.mockResolvedValue({ data: { mode: "sandbox", keyMode: "test" } });
    const out = await createDisputePayment(io, { disputeId: "d-1", userId: "u-1" });
    expect(out.paymentMode).toBe("MANUAL");
    expect(ax.request).not.toHaveBeenCalled();
  });

  it("ending the visit expires the checkout on the transaction's own gateway", async () => {
    await startVisit(1_000_000);
    ax.get.mockResolvedValue({ data: { mode: "live", keyMode: "live" } });
    ax.request.mockResolvedValue({ data: { checkoutId: "cs_9", checkoutUrl: "https://checkout.paymongo.com/cs_9" } });
    await createDisputePayment(io, { disputeId: "d-1", userId: "u-1" });
    E.PAYMENT_GATEWAY = "sandbox"; // switched since: the row is still live
    ax.request.mockReset();
    ax.request.mockResolvedValue({ data: { state: "open", amount: 300, livemode: true } });
    prismaMock.transaction.findUnique.mockResolvedValue(pendingTx({ id: "tx-9", amount: 300, paymongoCheckoutId: "cs_9", paymentEnv: "live" }));
    prismaMock.dispute.findUnique.mockResolvedValue({ id: "d-1", status: "PAYMENT_PENDING", rentalId: "r-1" } as never);
    await endVisit(io, "r-1", "timeout");
    expect((ax.request.mock.calls[0][0] as any).url).toBe("https://pay-live.example/checkouts/cs_9/expire");
  });
});
