import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * D-110 (found live 2026-09-25, rental 1125ad66): the admin refund accepted a
 * DEPOSIT_REFUND row — itself a refund — so three clicks in 16s chained three
 * "₱30 refunded" notices for one deposit. Only money the renter PAID can be
 * refunded. Runs the REAL adminRefund.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../../services/auditLogService", () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

import prisma from "../../config/database";
import { adminRefund } from "../adminController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeReq(): AuthRequest {
  return {
    params: { transactionId: "tx-1" },
    body: {},
    user: { userId: "admin-1", email: "admin@engirent.edu.ph", studentId: "a1", role: "ADMIN" },
  } as unknown as AuthRequest;
}
function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}
function txOfType(type: string) {
  prismaMock.transaction.findUnique.mockResolvedValue({
    id: "tx-1",
    type,
    status: "COMPLETED",
    amount: 30,
    rentalId: "r1",
    userId: "renter-1",
    rental: { item: { title: "Phillip Screw Driver" } },
    user: { id: "renter-1", firstName: "Ian", email: "i@x" },
  } as never);
}

describe("adminRefund — only money the renter paid", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.$transaction.mockResolvedValue([] as never);
  });

  it.each(["DEPOSIT_REFUND", "OWNER_PAYOUT"])("refuses to refund a %s row", async (type) => {
    txOfType(type);
    const next = jest.fn();
    await adminRefund(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(["SECURITY_DEPOSIT", "RENTAL_PAYMENT"])("refunds a %s", async (type) => {
    txOfType(type);
    const next = jest.fn();
    await adminRefund(makeReq(), makeRes(), next);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });
});
