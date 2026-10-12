import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * User ruling 2026-10-12: use every free compartment before saying "no locker";
 * only move an item that has PASSED its check; and an item not collected within
 * the grace hour drops so the top door is free, whatever its pick-up date.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { baysHoldingWrongItems } from "../disputeWrongItemService";
import { pickBayForDeposit } from "../pickupLaneService";
import { decideStorageDrop, DEFAULT_RETRIEVAL_POLICY, StorageDropCandidate } from "../retrievalPolicy";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const bay = (n: string, top: string, bottom: string, op = true) =>
  ({ id: `bay-${n}`, lockerNumber: n, topStatus: top, bottomStatus: bottom, isOperational: op }) as never;

describe("pickBayForDeposit", () => {
  it("a same-day deposit takes any bay with a free upper compartment, even with the lower busy", () => {
    const r = pickBayForDeposit([bay("1", "AVAILABLE", "OCCUPIED")] as never[], false) as never as { bay: { id: string } };
    expect(r.bay.id).toBe("bay-1");
  });

  it("a long-lead deposit prefers a bay with BOTH compartments free", () => {
    const r = pickBayForDeposit(
      [bay("1", "AVAILABLE", "OCCUPIED"), bay("2", "AVAILABLE", "AVAILABLE")] as never[],
      true,
    ) as never as { bay: { id: string }; waitsOnTop: boolean };
    expect(r.bay.id).toBe("bay-2");
    expect(r.waitsOnTop).toBe(false);
  });

  it("a long-lead deposit falls back to an upper-only bay (waits on top) before refusing", () => {
    const r = pickBayForDeposit(
      [bay("1", "AVAILABLE", "OCCUPIED"), bay("2", "OCCUPIED", "AVAILABLE")] as never[],
      true,
    ) as never as { bay: { id: string }; waitsOnTop: boolean };
    expect(r.bay.id).toBe("bay-1");
    expect(r.waitsOnTop).toBe(true);
  });

  it("refuses only when no bay has a free upper compartment, or none is operational", () => {
    expect(pickBayForDeposit([bay("1", "OCCUPIED", "AVAILABLE"), bay("2", "RESERVED", "AVAILABLE")] as never[], true)).toBeNull();
    expect(pickBayForDeposit([bay("1", "AVAILABLE", "AVAILABLE", false)] as never[], true)).toBeNull();
    expect(pickBayForDeposit([bay("1", "OCCUPIED", "OCCUPIED")] as never[], false)).toBeNull();
  });
});

describe("baysHoldingWrongItems (the 2026-10-12 case)", () => {
  beforeEach(() => mockReset(prismaMock));

  it("a wrong item already in the LOWER compartment no longer blocks the upper door", async () => {
    prismaMock.dispute.findMany.mockResolvedValue([{ wrongItemLockerId: "bay-1" }] as never);
    prismaMock.locker.findMany.mockResolvedValue([] as never); // top does not record this rental
    await expect(baysHoldingWrongItems("rental-1")).resolves.toEqual([]);
    expect(prismaMock.locker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["bay-1"] }, topRentalId: "rental-1" } }),
    );
  });

  it("a wrong item still on TOP keeps its bay excluded", async () => {
    prismaMock.dispute.findMany.mockResolvedValue([{ wrongItemLockerId: "bay-1" }] as never);
    prismaMock.locker.findMany.mockResolvedValue([{ id: "bay-1" }] as never);
    await expect(baysHoldingWrongItems("rental-1")).resolves.toEqual(["bay-1"]);
  });

  it("no wrong item recorded: nothing excluded, and no bay lookup", async () => {
    prismaMock.dispute.findMany.mockResolvedValue([] as never);
    await expect(baysHoldingWrongItems("rental-1")).resolves.toEqual([]);
    expect(prismaMock.locker.findMany).not.toHaveBeenCalled();
  });
});

describe("decideStorageDrop", () => {
  const noon = new Date(2026, 9, 12, 12, 0, 0); // inside the 7-21 window
  const hoursAgo = (h: number) => new Date(noon.getTime() - h * 3_600_000);
  const day = (offset: number) => new Date(2026, 9, 12 + offset);
  const base: StorageDropCandidate = {
    status: "DEPOSITED",
    verificationStatus: "APPROVED",
    releaseRequestedAt: null,
    depositedAt: hoursAgo(2),
    pickupDate: day(3), // Friday-ish: three days out
    onTop: true,
    lowerFree: true,
    isOperational: true,
    hasLiveKioskSession: false,
    hasOpenDoor: false,
  };
  const decide = (over: Partial<StorageDropCandidate>, now = noon) =>
    decideStorageDrop({ ...base, ...over }, now, DEFAULT_RETRIEVAL_POLICY);

  it("drops a checked item left over an hour, WHATEVER the pick-up date", () => {
    const r = decide({ depositedAt: hoursAgo(2), pickupDate: day(3) });
    expect(r).toEqual({ drop: true, reason: "LONG_LEAD_APPROVED" });
  });

  it("a pick-up date of TODAY (set, later this evening) no longer holds the top door past the grace hour", () => {
    expect(decide({ pickupDate: day(0), depositedAt: hoursAgo(2) })).toEqual({ drop: true, reason: "UNCOLLECTED_OVER_GRACE" });
    expect(decide({ pickupDate: day(0), depositedAt: hoursAgo(0.5) })).toMatchObject({ drop: false, code: "grace_not_elapsed" });
  });

  it("a checked long-lead item that waited on top drops as soon as the lower is free", () => {
    expect(decide({ depositedAt: hoursAgo(0.1), pickupDate: day(3) })).toEqual({ drop: true, reason: "LONG_LEAD_APPROVED" });
  });

  it("never moves an item nobody has checked", () => {
    for (const verificationStatus of ["PENDING", "REJECTED", "RETRY", ""]) {
      expect(decide({ verificationStatus })).toMatchObject({ drop: false, code: "not_checked" });
    }
  });

  it("never drops onto an occupied lower compartment, or when the item is not on top", () => {
    expect(decide({ lowerFree: false })).toMatchObject({ drop: false, code: "lower_compartment_full" });
    expect(decide({ onTop: false })).toMatchObject({ drop: false, code: "not_on_top" });
  });

  it("keeps every hardware guard: busy bay, out of service, out of hours", () => {
    expect(decide({ hasLiveKioskSession: true })).toMatchObject({ drop: false, code: "bay_busy" });
    expect(decide({ hasOpenDoor: true })).toMatchObject({ drop: false, code: "bay_busy" });
    expect(decide({ isOperational: false })).toMatchObject({ drop: false, code: "bay_not_operational" });
    expect(decide({}, new Date(2026, 9, 12, 23, 0, 0))).toMatchObject({ drop: false, code: "outside_release_window" });
  });

  it("an item already being released is left alone", () => {
    expect(decide({ releaseRequestedAt: noon })).toMatchObject({ drop: false, code: "already_requested" });
  });

  it("same-day: waits out the grace hour, then R1 (cancel + return to owner) owns it, not this sweep", () => {
    const sameDay = { pickupDate: null };
    expect(decide({ ...sameDay, depositedAt: hoursAgo(0.5) })).toMatchObject({ drop: false, code: "grace_not_elapsed" });
    expect(decide({ ...sameDay, depositedAt: hoursAgo(2) })).toMatchObject({ drop: false, code: "left_to_r1" });
  });

  it("a pick-up day that has ended is R1's too (the renter is late)", () => {
    expect(decide({ pickupDate: day(-2), depositedAt: hoursAgo(80) })).toMatchObject({ drop: false, code: "left_to_r1" });
  });
});
