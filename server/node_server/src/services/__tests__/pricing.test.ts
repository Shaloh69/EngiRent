import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

// Renter fees (user ruling 2026-10-21). The user's own examples are the tests:
// ₱100/day, 2%, ₱10 -> "₱102/day", 1 day ₱112, 3 days ₱316. Each rule was
// removed once and a test here failed (PROGRESS.md, PHASE RENTER FEES).

jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));

import prisma from "../../config/database";
import { DEFAULT_FEES, displayPricePerDay, getFees, platformFeeOn, quote, saveFees, validateFees } from "../pricing";

const db = prisma as unknown as DeepMockProxy<PrismaClient>;
beforeEach(() => mockReset(db));

describe("the user's examples (₱100/day, 2%, ₱10)", () => {
  it("shows ₱102 per day (the platform fee inside the daily price)", () => {
    expect(displayPricePerDay(100, DEFAULT_FEES)).toBe(102);
  });
  it("1 day = ₱112: rent 100 + platform 2 + service 10", () => {
    expect(quote(100, 1, DEFAULT_FEES)).toEqual({ rent: 100, platformFee: 2, serviceFee: 10, total: 112 });
  });
  it("3 days = ₱316: the ₱10 is charged ONCE per rental, not per day", () => {
    expect(quote(100, 3, DEFAULT_FEES)).toEqual({ rent: 300, platformFee: 6, serviceFee: 10, total: 316 });
  });
  it("the ₱1 test listing: ₱11.02", () => {
    expect(quote(1, 1, DEFAULT_FEES).total).toBe(11.02);
  });
  it("rounds to whole centavos", () => {
    const q = quote(33.33, 3, { platformFeePct: 2.5, serviceFee: 10 });
    expect(q.rent).toBe(99.99);
    expect(q.platformFee).toBe(2.5);
    expect(q.total).toBe(112.49);
    expect(displayPricePerDay(33.33, { platformFeePct: 2.5, serviceFee: 10 })).toBe(34.16);
  });
  it("uses the given settings, not fixed numbers", () => {
    expect(quote(100, 1, { platformFeePct: 5, serviceFee: 15 })).toEqual({ rent: 100, platformFee: 5, serviceFee: 15, total: 120 });
  });
  it("an extension's extra rent pays the platform fee too", () => {
    expect(platformFeeOn(200, DEFAULT_FEES)).toBe(4);
  });
});

describe("validateFees (admin input)", () => {
  it("accepts sensible values (numbers or numeric strings)", () => {
    expect(validateFees({ platformFeePct: 2, serviceFee: 10 })).toEqual({ platformFeePct: 2, serviceFee: 10 });
    expect(validateFees({ platformFeePct: "3.5", serviceFee: "12" })).toEqual({ platformFeePct: 3.5, serviceFee: 12 });
    expect(validateFees({ platformFeePct: 0, serviceFee: 0 })).toEqual({ platformFeePct: 0, serviceFee: 0 });
  });
  it("refuses negative, too large or missing values", () => {
    expect(typeof validateFees({ platformFeePct: -1, serviceFee: 10 })).toBe("string");
    expect(typeof validateFees({ platformFeePct: 21, serviceFee: 10 })).toBe("string");
    expect(typeof validateFees({ platformFeePct: 2, serviceFee: -5 })).toBe("string");
    expect(typeof validateFees({ platformFeePct: 2, serviceFee: 101 })).toBe("string");
    expect(typeof validateFees({ platformFeePct: 2 })).toBe("string");
    expect(typeof validateFees({ platformFeePct: "abc", serviceFee: 10 })).toBe("string");
  });
});

describe("getFees / saveFees", () => {
  it("no saved row: the defaults (2%, ₱10)", async () => {
    db.feeConfig.findUnique.mockResolvedValue(null as never);
    await expect(getFees()).resolves.toEqual({ platformFeePct: 2, serviceFee: 10 });
  });
  it("a saved row wins", async () => {
    db.feeConfig.findUnique.mockResolvedValue({ id: 1, platformFeePct: 3, serviceFee: 15 } as never);
    await expect(getFees()).resolves.toEqual({ platformFeePct: 3, serviceFee: 15 });
  });
  it("saving writes row 1 and records who changed it", async () => {
    db.feeConfig.upsert.mockResolvedValue({ id: 1, platformFeePct: 4, serviceFee: 12 } as never);
    await saveFees({ platformFeePct: 4, serviceFee: 12 }, "admin-1");
    expect(db.feeConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, update: expect.objectContaining({ updatedById: "admin-1" }) }));
  });
});
