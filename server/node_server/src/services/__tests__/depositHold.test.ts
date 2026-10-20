import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * Concerns v2, ruling 2 (2026-10-13): a passed return pays the owner but HOLDS the
 * renter's deposit until the owner has had the chance to report hidden damage.
 * Runs the REAL settlement code; Prisma, PayMongo and the payout rail are mocked
 * (no PAYMONGO key, so every money movement is the ledger path).
 */

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("../../controllers/paymentController", () => ({ createRefund: jest.fn() }));
jest.mock("../payoutService", () => ({ createTransfer: jest.fn() }));
jest.mock("../../config/env", () => ({ __esModule: true, default: {} }));
jest.mock("../../utils/crypto", () => ({ decryptJson: jest.fn(), isEncryptedBlob: () => false }));

import prisma from "../../config/database";
import {
  DEPOSIT_HOLD_MAX_HOURS,
  finalizeRentalCompletion,
  releaseHeldDeposit,
} from "../rentalSettlementService";
import { runDepositHoldSweep } from "../collectionSweepService";

const db = prisma as unknown as DeepMockProxy<PrismaClient>;

function rental(transactions: object[]) {
  return {
    id: "r1",
    renterId: "renter-1",
    ownerId: "owner-1",
    item: { title: "Calculator" },
    renter: { id: "renter-1", email: "r@x", firstName: "R" },
    owner: { id: "owner-1", email: "o@x", firstName: "O", payoutProvider: null, payoutBic: null, payoutInstitutionName: null, payoutAccountName: null, payoutAccountNumber: null },
    transactions,
  };
}
const DEPOSIT = { id: "t-dep", type: "SECURITY_DEPOSIT", amount: 300, paymongoPaymentId: null };
const RENT = { id: "t-pay", type: "RENTAL_PAYMENT", amount: 90, paymongoPaymentId: null };

const createdTypes = () =>
  db.transaction.create.mock.calls.map((c) => (c[0] as { data: { type: string; amount: number } }).data);

beforeEach(() => {
  mockReset(db);
  db.$transaction.mockImplementation((async (ops: unknown) => ops) as never);
});

describe("finalizeRentalCompletion with holdDeposit", () => {
  it("pays the owner but does NOT refund the deposit; sets a 72 h hold and tells the renter", async () => {
    db.rental.findUnique.mockResolvedValue(rental([DEPOSIT, RENT]) as never);
    const before = Date.now();
    await finalizeRentalCompletion("r1", { holdDeposit: true });

    const types = [...createdTypes().map((d) => d.type)];
    expect(types).toContain("OWNER_PAYOUT");
    expect(types).not.toContain("DEPOSIT_REFUND");
    const hold = (db.rental.update.mock.calls[0][0] as { data: { depositHoldUntil: Date } }).data.depositHoldUntil;
    expect(hold.getTime()).toBeGreaterThanOrEqual(before + DEPOSIT_HOLD_MAX_HOURS * 3_600_000 - 1000);
    const note = db.notification.create.mock.calls.map((c) => (c[0] as { data: { title: string } }).data.title);
    expect(note).toContain("Deposit held while the owner checks the item");
  });

  it("without the hold (force-complete, dispute settlement) the deposit is refunded at once, as before", async () => {
    db.rental.findUnique.mockResolvedValue(rental([DEPOSIT, RENT]) as never);
    await finalizeRentalCompletion("r1");
    expect(createdTypes().map((d) => d.type)).toContain("DEPOSIT_REFUND");
  });

  it("rent given back for a defect comes out of the owner's payout", async () => {
    db.rental.findUnique.mockResolvedValue(rental([DEPOSIT, RENT, { id: "t-rr", type: "RENTAL_REFUND", amount: 60 }]) as never);
    await finalizeRentalCompletion("r1", { holdDeposit: true });
    const payout = createdTypes().find((d) => d.type === "OWNER_PAYOUT")!;
    expect(payout.amount).toBe(30);
  });
});

describe("releaseHeldDeposit", () => {
  it("refunds the deposit minus damage already logged, and clears the hold", async () => {
    db.rental.findUnique.mockResolvedValue(rental([DEPOSIT, RENT, { id: "t-dmg", type: "DAMAGE_FEE", amount: 100 }]) as never);
    db.transaction.count.mockResolvedValue(0 as never);
    await expect(releaseHeldDeposit("r1", "test")).resolves.toBe(true);
    const refund = createdTypes().find((d) => d.type === "DEPOSIT_REFUND")!;
    expect(refund.amount).toBe(200);
    expect(db.rental.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { depositHoldUntil: null } });
  });

  it("never refunds twice", async () => {
    db.rental.findUnique.mockResolvedValue(rental([DEPOSIT, RENT]) as never);
    db.transaction.count.mockResolvedValue(1 as never);
    await expect(releaseHeldDeposit("r1", "test")).resolves.toBe(false);
    expect(createdTypes().find((d) => d.type === "DEPOSIT_REFUND")).toBeUndefined();
  });
});

describe("runDepositHoldSweep", () => {
  it("releases an expired hold, but waits while a damage report is open", async () => {
    db.rental.findMany.mockResolvedValue([
      { id: "r1", renterId: "renter-1", item: { title: "Calculator" } },
      { id: "r2", renterId: "renter-2", item: { title: "Pico" } },
    ] as never);
    db.concern.count.mockImplementation((async (args: { where: { rentalId: string } }) => (args.where.rentalId === "r2" ? 1 : 0)) as never);
    db.rental.findUnique.mockResolvedValue(rental([DEPOSIT, RENT]) as never);
    db.transaction.count.mockResolvedValue(0 as never);
    db.transaction.findFirst.mockResolvedValue({ amount: 300 } as never);

    const r = await runDepositHoldSweep(new Date());
    expect(r).toEqual({ due: 2, released: 1, waitingOnCase: 1 });
    const titles = db.notification.create.mock.calls.map((c) => (c[0] as { data: { title: string } }).data.title);
    expect(titles).toContain("Deposit refunded");
  });
});

describe("P2: a PayMongo deposit with NO PayMongo key on this server", () => {
  const PM_DEPOSIT = { id: "t-dep", type: "SECURITY_DEPOSIT", amount: 300, paymongoPaymentId: "pay_dep", paymentEnv: "sandbox" };
  const { createRefund } = jest.requireMock("../../controllers/paymentController");
  beforeEach(() => (createRefund as jest.Mock).mockReset());

  it("is refunded through its own gateway, not as a ledger-only refund", async () => {
    (createRefund as jest.Mock).mockResolvedValue("ref_1");
    db.rental.findUnique.mockResolvedValue(rental([PM_DEPOSIT, RENT]) as never);
    await finalizeRentalCompletion("r1");
    expect(createRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentId: "pay_dep", amount: 300, from: expect.objectContaining({ id: "t-dep" }) }));
    const dep = createdTypes().find((d) => d.type === "DEPOSIT_REFUND") as { paymentMethod?: string } | undefined;
    expect(dep?.paymentMethod).toBe("PayMongo");
  });

  it("a refund the gateway can't make leaves the deposit owed (no DEPOSIT_REFUND, not REFUNDED) and tells the renter", async () => {
    (createRefund as jest.Mock).mockRejectedValue(new Error("its sandbox payment gateway is not configured on this server"));
    db.rental.findUnique.mockResolvedValue(rental([PM_DEPOSIT, RENT]) as never);
    await finalizeRentalCompletion("r1");
    expect(createdTypes().find((d) => d.type === "DEPOSIT_REFUND")).toBeUndefined();
    const refunded = db.transaction.update.mock.calls.some((c) => (c[0] as { data: { status?: string } }).data.status === "REFUNDED");
    expect(refunded).toBe(false);
    const titles = db.notification.create.mock.calls.map((c) => (c[0] as { data: { title: string } }).data.title);
    expect(titles).toContain("Deposit Refund Delayed");
  });
});

describe("renter fees (2026-10-21): the owner is paid the RENT only", () => {
  it("₱112 paid (rent 100 + platform 2 + service 10): owner payout ₱100", async () => {
    const r = { ...rental([DEPOSIT, { ...RENT, amount: 112 }]), platformFee: 2, serviceFee: 10 };
    db.rental.findUnique.mockResolvedValue(r as never);
    await finalizeRentalCompletion("r1", { holdDeposit: true });
    expect(createdTypes().find((d) => d.type === "OWNER_PAYOUT")!.amount).toBe(100);
  });
  it("a rental booked before the fees (no fee columns): payout is the whole payment, as before", async () => {
    // a fresh copy: the settlement adjusts the payment object in place, and an
    // earlier test in this file has already reduced the shared RENT fixture
    db.rental.findUnique.mockResolvedValue(rental([{ ...DEPOSIT }, { ...RENT, amount: 90 }]) as never);
    await finalizeRentalCompletion("r1", { holdDeposit: true });
    expect(createdTypes().find((d) => d.type === "OWNER_PAYOUT")!.amount).toBe(90);
  });
  it("never negative", async () => {
    const r = { ...rental([DEPOSIT, { ...RENT, amount: 5 }]), platformFee: 2, serviceFee: 10 };
    db.rental.findUnique.mockResolvedValue(r as never);
    await finalizeRentalCompletion("r1", { holdDeposit: true });
    expect(createdTypes().find((d) => d.type === "OWNER_PAYOUT")!.amount).toBe(0);
  });
});
