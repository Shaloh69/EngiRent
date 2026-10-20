import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

// PUT /admin/fees (renter fees, 2026-10-21): bad input saves nothing; good
// input is saved and audited.
jest.mock("../../config/database", () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
jest.mock("../../services/auditLogService", () => ({ recordAudit: jest.fn() }));

import prisma from "../../config/database";
import { recordAudit } from "../../services/auditLogService";
import { getFeeSettings, updateFeeSettings } from "../adminController";
import { AuthRequest } from "../../middleware/auth";

const db = prisma as unknown as DeepMockProxy<PrismaClient>;
const res = () => {
  const r: Partial<Response> = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r as Response;
};
const req = (body: unknown) => ({ body, user: { userId: "admin-1", role: "ADMIN" } }) as unknown as AuthRequest;

beforeEach(() => {
  mockReset(db);
  (recordAudit as jest.Mock).mockClear();
  db.feeConfig.findUnique.mockResolvedValue(null as never);
});

it("refuses a fee outside the limits and saves nothing", async () => {
  const next = jest.fn();
  await updateFeeSettings(req({ platformFeePct: 50, serviceFee: 10 }), res(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  expect(db.feeConfig.upsert).not.toHaveBeenCalled();
  expect(recordAudit).not.toHaveBeenCalled();
});

it("saves good values, audits before/after, and says it applies to new bookings", async () => {
  db.feeConfig.upsert.mockResolvedValue({ id: 1, platformFeePct: 3, serviceFee: 12 } as never);
  const r = res();
  await updateFeeSettings(req({ platformFeePct: 3, serviceFee: 12 }), r, jest.fn());
  expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "fees.update", metadata: { before: { platformFeePct: 2, serviceFee: 10 }, after: { platformFeePct: 3, serviceFee: 12 } } }));
  expect((r.json as jest.Mock).mock.calls[0][0].message).toMatch(/new bookings/);
});

it("GET returns the current fees and the limits", async () => {
  const r = res();
  await getFeeSettings(req({}), r, jest.fn());
  expect((r.json as jest.Mock).mock.calls[0][0].data).toEqual({ fees: { platformFeePct: 2, serviceFee: 10 }, limits: { maxPlatformFeePct: 20, maxServiceFee: 100 } });
});
