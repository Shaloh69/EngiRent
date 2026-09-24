import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * The hourly R1 sweep, moved out of index.ts (2026-09-25) so an admin can run
 * it on demand. Same behaviour: release through the policy, and cancel +
 * void only a LATE_COLLECTION release (D-91).
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../retrievalService", () => ({ requestRelease: jest.fn() }));
jest.mock("../overdueRentalCleanup", () => ({ voidRentalTransactions: jest.fn().mockResolvedValue(2) }));

import prisma from "../../config/database";
import { runCollectionSweep } from "../collectionSweepService";
import { requestRelease } from "../retrievalService";
import { voidRentalTransactions } from "../overdueRentalCleanup";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const releaseMock = requestRelease as jest.Mock;
const io = {} as never;

describe("runCollectionSweep", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    releaseMock.mockReset();
    (voidRentalTransactions as jest.Mock).mockClear();
  });

  it("cancels and voids a deposit released for late collection", async () => {
    prismaMock.rental.findMany.mockResolvedValue([{ id: "r1" }] as never);
    releaseMock.mockResolvedValue({ released: true, reason: "LATE_COLLECTION", lockerNumber: "1" });
    const out = await runCollectionSweep(io);
    expect(out).toEqual({ considered: 1, released: 1, cancelled: 1, refusals: [] });
    expect(prismaMock.rental.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "CANCELLED" } });
    expect(voidRentalTransactions).toHaveBeenCalledWith("r1");
  });

  it("changes nothing when the policy refuses, and says why", async () => {
    prismaMock.rental.findMany.mockResolvedValue([{ id: "r1" }] as never);
    releaseMock.mockResolvedValue({ released: false, refusal: "outside the release window 7:00-21:00" });
    const out = await runCollectionSweep(io);
    expect(out.cancelled).toBe(0);
    expect(out.refusals).toEqual(["r1: outside the release window 7:00-21:00"]);
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("can be limited to one rental", async () => {
    prismaMock.rental.findMany.mockResolvedValue([] as never);
    await runCollectionSweep(io, "only-this");
    expect(prismaMock.rental.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "only-this", status: "DEPOSITED" }) }),
    );
  });
});
