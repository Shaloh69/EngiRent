import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * 2026-09-25: "Hand Rivets" stayed isAvailable=false after its only rental
 * was CANCELLED by the R1 no-show sweep and the tool was back with its owner.
 * Three cancel paths never recomputed; the reconcile repairs what they left.
 * Runs the REAL itemAvailabilityService against a mocked Prisma.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { reconcileItemAvailability } from "../itemAvailabilityService";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("reconcileItemAvailability", () => {
  beforeEach(() => mockReset(prismaMock));

  it("frees an item whose only rental is cancelled", async () => {
    prismaMock.item.findMany.mockResolvedValue([{ id: "hand-rivets", isAvailable: false }] as never);
    prismaMock.rental.findFirst.mockResolvedValue(null); // nothing blocking
    prismaMock.item.findUnique.mockResolvedValue({ isAvailable: true } as never);

    await expect(reconcileItemAvailability()).resolves.toBe(1);
    expect(prismaMock.item.update).toHaveBeenCalledWith({
      where: { id: "hand-rivets" },
      data: { isAvailable: true },
    });
  });

  it("keeps an item unavailable while a rental genuinely holds it", async () => {
    prismaMock.item.findMany.mockResolvedValue([{ id: "screwdriver", isAvailable: false }] as never);
    prismaMock.rental.findFirst.mockResolvedValue({ id: "active-rental" } as never);
    prismaMock.item.findUnique.mockResolvedValue({ isAvailable: false } as never);

    await expect(reconcileItemAvailability()).resolves.toBe(0);
    expect(prismaMock.item.update).toHaveBeenCalledWith({
      where: { id: "screwdriver" },
      data: { isAvailable: false },
    });
  });

  it("an item physically with the renter blocks even when the rental is OVERDUE — and a wrongly AVAILABLE item is corrected", async () => {
    prismaMock.item.findMany.mockResolvedValue([{ id: "screwdriver", isAvailable: true }] as never);
    prismaMock.rental.findFirst.mockResolvedValue({ id: "overdue-active" } as never);
    prismaMock.item.findUnique.mockResolvedValue({ isAvailable: false } as never);

    await expect(reconcileItemAvailability()).resolves.toBe(1);
    expect(prismaMock.item.update).toHaveBeenCalledWith({ where: { id: "screwdriver" }, data: { isAvailable: false } });

    const where = (prismaMock.rental.findFirst.mock.calls[0][0] as { where: { OR: unknown[] } }).where;
    // The physically-committed arm carries NO date condition — an overdue
    // rental's end date is in the past while the renter still holds the item.
    expect(where.OR[0]).toEqual({ status: { in: ["DEPOSITED", "ACTIVE", "VERIFICATION"] } });
  });
});
