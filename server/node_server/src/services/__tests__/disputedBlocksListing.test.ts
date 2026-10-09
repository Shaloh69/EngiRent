import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * User ruling 2026-10-10 (D-115): a DISPUTED rental keeps its listing blocked.
 *
 * Found on the first physical test of the v2 item check: a wrong tool returned
 * as Hand Rivets sent the rental to DISPUTED and the listing read
 * isAvailable=true, with the real rivet tool possibly still with the renter. A
 * new rental is gated by findOverlappingRentals (dates), not by isAvailable, so
 * BOTH have to know about DISPUTED. Runs the REAL itemAvailabilityService against
 * a mocked Prisma and checks the queries it builds.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { findOverlappingRentals, recomputeItemAvailability } from "../itemAvailabilityService";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("findOverlappingRentals — the booking gate", () => {
  beforeEach(() => mockReset(prismaMock));

  it("always includes a DISPUTED rental, whatever its dates", async () => {
    prismaMock.rental.findMany.mockResolvedValue([] as never);
    await findOverlappingRentals("item-1", new Date("2030-01-01"), new Date("2030-01-03"));
    const where = (prismaMock.rental.findMany.mock.calls[0][0] as any).where;
    expect(where.itemId).toBe("item-1");
    expect(where.OR).toContainEqual({ status: "DISPUTED" });
  });

  it("still blocks every other committed status only inside its own dates", async () => {
    prismaMock.rental.findMany.mockResolvedValue([] as never);
    const start = new Date("2030-01-01");
    const end = new Date("2030-01-03");
    await findOverlappingRentals("item-1", start, end);
    const where = (prismaMock.rental.findMany.mock.calls[0][0] as any).where;
    const dated = where.OR.find((c: any) => c.startDate);
    expect(dated.status.in).toEqual(["PENDING", "AWAITING_DEPOSIT", "DEPOSITED", "ACTIVE", "VERIFICATION"]);
    expect(dated.startDate).toEqual({ lt: end });
    expect(dated.endDate).toEqual({ gt: start });
  });

  it("an excluded rental stays excluded (extending your own rental ignores itself)", async () => {
    prismaMock.rental.findMany.mockResolvedValue([] as never);
    await findOverlappingRentals("item-1", new Date("2030-01-01"), new Date("2030-01-03"), "mine");
    const where = (prismaMock.rental.findMany.mock.calls[0][0] as any).where;
    expect(where.id).toEqual({ not: "mine" });
  });
});

describe("recomputeItemAvailability — the listing flag", () => {
  beforeEach(() => mockReset(prismaMock));

  it("counts a DISPUTED rental as physically committing the item", async () => {
    prismaMock.rental.findFirst.mockResolvedValue({ id: "disputed" } as never);
    await recomputeItemAvailability("item-1");
    const where = (prismaMock.rental.findFirst.mock.calls[0][0] as any).where;
    const committed = where.OR.find((c: any) => c.status?.in?.includes("ACTIVE"));
    expect(committed.status.in).toContain("DISPUTED");
    expect(prismaMock.item.update).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { isAvailable: false } });
  });

  it("frees the item again once nothing holds it (a settled dispute is COMPLETED, not DISPUTED)", async () => {
    prismaMock.rental.findFirst.mockResolvedValue(null);
    await recomputeItemAvailability("item-1");
    expect(prismaMock.item.update).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { isAvailable: true } });
  });
});
