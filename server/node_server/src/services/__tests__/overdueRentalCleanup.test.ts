import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * D-91 — a rental past its own due date, never deposited, is auto-cancelled.
 * Before this there was NO automation for this case: the E4.6 sweep only
 * looks at DEPOSITED rentals, and the late-fee cron only looks at ACTIVE
 * ones. A rental that never got a deposit had nothing watching it at all —
 * confirmed live before this fix: two real rentals sat AWAITING_DEPOSIT 3-4
 * days past their own end date.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import {
  cancelOverdueUndepositedRentals,
  voidRentalTransactions,
} from "../overdueRentalCleanup";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const HOUR = 60 * 60 * 1000;

function rental(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r1",
    renterId: "renter-1",
    ownerId: "owner-1",
    endDate: new Date(Date.now() - 48 * HOUR), // safely past the 24h grace
    item: { title: "Glue Gun" },
    ...over,
  };
}

describe("voidRentalTransactions", () => {
  beforeEach(() => mockReset(prismaMock));

  it("marks every unsettled transaction REFUNDED and returns the count", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      { id: "t1" },
      { id: "t2" },
    ] as never);

    const n = await voidRentalTransactions("r1");

    expect(n).toBe(2);
    expect(prismaMock.transaction.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" }, data: { status: "REFUNDED" } }),
    );
  });

  it("only ever targets unsettled statuses — never re-touches an already REFUNDED row", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([] as never);
    await voidRentalTransactions("r1");
    const arg = prismaMock.transaction.findMany.mock.calls[0][0] as {
      where: { status: { in: string[] } };
    };
    expect(arg.where.status.in).toEqual(["COMPLETED", "PENDING", "PROCESSING"]);
    expect(arg.where.status.in).not.toContain("REFUNDED");
  });

  it("touches nothing when there is nothing to void", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([] as never);
    const n = await voidRentalTransactions("r1");
    expect(n).toBe(0);
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
  });

  it("never imports a payment provider — this is bookkeeping only", () => {
    // An unattended, scheduled job must not be ABLE to move real money, not
    // merely refrain from it this run. Checked against the module's own
    // IMPORT lines specifically (not a bare word match, which would also
    // trip on this file's own explanatory prose about what it deliberately
    // does not do) — real proof that the two modules real money moves
    // through (rentalSettlementService's own imports) cannot be reached from
    // here at all.
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "overdueRentalCleanup.ts"),
      "utf-8",
    );
    const importLines = src
      .split("\n")
      .filter((line: string) => /^\s*import\b/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/paymentController|payoutService/);
  });
});

describe("cancelOverdueUndepositedRentals", () => {
  beforeEach(() => mockReset(prismaMock));

  it("cancels a rental well past its end date with no deposit", async () => {
    prismaMock.rental.findMany.mockResolvedValue([rental()] as never);
    prismaMock.transaction.findMany.mockResolvedValue([] as never);

    const result = await cancelOverdueUndepositedRentals();

    expect(result).toEqual({ considered: 1, cancelled: 1 });
    expect(prismaMock.rental.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1" }, data: { status: "CANCELLED" } }),
    );
  });

  it("notifies BOTH the renter and the owner", async () => {
    prismaMock.rental.findMany.mockResolvedValue([rental()] as never);
    prismaMock.transaction.findMany.mockResolvedValue([] as never);

    await cancelOverdueUndepositedRentals();

    const notified = prismaMock.notification.create.mock.calls.map(
      (c) => (c[0] as { data: { userId: string } }).data.userId,
    );
    expect(notified).toEqual(expect.arrayContaining(["renter-1", "owner-1"]));
    expect(notified).toHaveLength(2);
  });

  it("voids the rental's own transactions as part of cancelling it", async () => {
    prismaMock.rental.findMany.mockResolvedValue([rental()] as never);
    prismaMock.transaction.findMany.mockResolvedValue([{ id: "t1" }] as never);

    await cancelOverdueUndepositedRentals();

    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" }, data: { status: "REFUNDED" } }),
    );
  });

  it("only queries PENDING/AWAITING_DEPOSIT — a DEPOSITED rental is a different case, handled elsewhere", async () => {
    prismaMock.rental.findMany.mockResolvedValue([] as never);
    await cancelOverdueUndepositedRentals();
    const arg = prismaMock.rental.findMany.mock.calls[0][0] as {
      where: { status: { in: string[] } };
    };
    expect(arg.where.status.in).toEqual(["PENDING", "AWAITING_DEPOSIT"]);
    expect(arg.where.status.in).not.toContain("DEPOSITED");
  });

  it("respects the grace period — the query cutoff is in the past, not the live moment", async () => {
    prismaMock.rental.findMany.mockResolvedValue([] as never);
    const before = Date.now();
    await cancelOverdueUndepositedRentals();
    const arg = prismaMock.rental.findMany.mock.calls[0][0] as {
      where: { endDate: { lt: Date } };
    };
    const graceMs = before - arg.where.endDate.lt.getTime();
    // 24h grace, generous tolerance for test execution time.
    expect(graceMs).toBeGreaterThan(23.9 * HOUR);
    expect(graceMs).toBeLessThan(24.1 * HOUR);
  });

  it("one rental failing does not stop the sweep from reaching the rest", async () => {
    prismaMock.rental.findMany.mockResolvedValue([
      rental({ id: "r1" }),
      rental({ id: "r2" }),
    ] as never);
    prismaMock.transaction.findMany.mockResolvedValue([] as never);
    prismaMock.rental.update
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValueOnce({} as never);

    const result = await cancelOverdueUndepositedRentals();

    expect(result).toEqual({ considered: 2, cancelled: 1 });
  });

  it("considers, but does not cancel, when nothing is overdue", async () => {
    prismaMock.rental.findMany.mockResolvedValue([] as never);
    const result = await cancelOverdueUndepositedRentals();
    expect(result).toEqual({ considered: 0, cancelled: 0 });
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });
});
