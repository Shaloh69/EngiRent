import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * E6.V (user ruling 2026-09-25, D-109): when the owner deposits the wrong item
 * and it is rejected, the renter is refunded IN FULL, automatically. Found on
 * rental 1125ad66: CANCELLED, with ₱20 + ₱30 still COMPLETED and nothing sent
 * back. Runs the REAL helper; Prisma and the PayMongo call are mocked.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../../controllers/paymentController", () => ({ createRefund: jest.fn().mockResolvedValue({}) }));
jest.mock("../payoutService", () => ({ createTransfer: jest.fn() }));
jest.mock("../../config/env", () => ({ __esModule: true, default: { PAYMONGO_SECRET_KEY: "sk_test_x" } }));

import prisma from "../../config/database";
import { refundRenterInFull } from "../rentalSettlementService";
import { createRefund } from "../../controllers/paymentController";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const refundMock = createRefund as jest.Mock;

function rentalWith(transactions: object[]) {
  prismaMock.rental.findUnique.mockResolvedValue({
    id: "r1",
    renterId: "renter-1",
    item: { title: "Phillip Screw Driver" },
    transactions,
  } as never);
}

describe("refundRenterInFull", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    refundMock.mockReset().mockResolvedValue({});
    prismaMock.$transaction.mockResolvedValue([] as never);
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }] as never);
  });

  it("refunds the rental payment AND the deposit — ledger-only for manual (GCash) payments", async () => {
    rentalWith([
      { id: "t-pay", type: "RENTAL_PAYMENT", amount: 20, paymongoPaymentId: null, paymentDetails: null },
      { id: "t-dep", type: "SECURITY_DEPOSIT", amount: 30, paymongoPaymentId: null, paymentDetails: null },
    ]);

    await expect(refundRenterInFull("r1", "wrong item")).resolves.toBe(50);

    expect(refundMock).not.toHaveBeenCalled();
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t-pay" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t-dep" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
    expect(prismaMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "DEPOSIT_REFUND", amount: 30, status: "COMPLETED", userId: "renter-1" }),
    });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "renter-1", title: "Refunded in full" }),
    });
  });

  it("uses a real PayMongo refund when the payment went through PayMongo", async () => {
    rentalWith([{ id: "t-pay", type: "RENTAL_PAYMENT", amount: 20, paymongoPaymentId: "pay_123", paymentDetails: null }]);
    await refundRenterInFull("r1", "wrong item");
    expect(refundMock).toHaveBeenCalledWith({ paymentId: "pay_123", amount: 20, reason: "others" });
  });

  it("a failed PayMongo refund leaves the row owed and tells the renter and the admins", async () => {
    rentalWith([{ id: "t-pay", type: "RENTAL_PAYMENT", amount: 20, paymongoPaymentId: "pay_123", paymentDetails: null }]);
    refundMock.mockRejectedValueOnce(new Error("paymongo down"));

    await expect(refundRenterInFull("r1", "wrong item")).resolves.toBe(0);

    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).toHaveBeenCalled();
  });

  it("is idempotent — nothing COMPLETED left, nothing refunded", async () => {
    rentalWith([]);
    await expect(refundRenterInFull("r1", "wrong item")).resolves.toBe(0);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});
