import {
  canAcceptDeposit,
  deriveLockerStatus,
  doorHoldingRental,
  isFullyOccupied,
  isLongLeadPickup,
  laneForDeposit,
  CompartmentState,
} from "../pickupLaneService";

/**
 * E5 — the rules that decide which verification lane a deposit takes and
 * whether a bay may receive it.
 *
 * Every case here guards one of two things: a student's item being checked by
 * the wrong lane, or two students' property ending up stacked in one
 * compartment. The second is the invariant written at
 * `LockerStatus.AWAITING_RETRIEVAL`, and on 2026-09-18 it was nearly broken
 * twice in one afternoon — once by bays that became permanently unassignable,
 * once by a release that would have stroked an item onto a stored one.
 */

const FREE: CompartmentState = {
  topStatus: "AVAILABLE",
  bottomStatus: "AVAILABLE",
  isOperational: true,
};

/** 2026-09-18 14:00 local. */
const NOW = new Date(2026, 8, 18, 14, 0, 0);

describe("isLongLeadPickup — 'above one day' means not today, by calendar", () => {
  it("a null pick-up date reads as today, so pre-E5 rentals keep their path", () => {
    expect(isLongLeadPickup(null, NOW)).toBe(false);
    expect(isLongLeadPickup(undefined, NOW)).toBe(false);
  });

  it("later today is NOT long-lead", () => {
    expect(isLongLeadPickup(new Date(2026, 8, 18, 23, 30, 0), NOW)).toBe(false);
  });

  it("earlier today is NOT long-lead", () => {
    expect(isLongLeadPickup(new Date(2026, 8, 18, 6, 0, 0), NOW)).toBe(false);
  });

  it("tomorrow morning IS long-lead, even though it is under 24h away", () => {
    // 08:00 tomorrow is 18h from NOW. A 24h rule would call this same-day.
    expect(isLongLeadPickup(new Date(2026, 8, 19, 8, 0, 0), NOW)).toBe(true);
  });

  it("several days out is long-lead", () => {
    expect(isLongLeadPickup(new Date(2026, 8, 22, 12, 0, 0), NOW)).toBe(true);
  });

  it("laneForDeposit follows it", () => {
    expect(laneForDeposit(null, NOW)).toBe("fast");
    expect(laneForDeposit(new Date(2026, 8, 20), NOW)).toBe("full");
  });
});

describe("canAcceptDeposit — the stacking guard at assignment time", () => {
  it("an empty operational bay takes either kind of deposit", () => {
    expect(canAcceptDeposit(FREE, false)).toBe(true);
    expect(canAcceptDeposit(FREE, true)).toBe(true);
  });

  it("an out-of-service bay takes nothing", () => {
    expect(canAcceptDeposit({ ...FREE, isOperational: false }, false)).toBe(false);
  });

  it("an occupied upper compartment takes nothing", () => {
    const b = { ...FREE, topStatus: "OCCUPIED" as const };
    expect(canAcceptDeposit(b, false)).toBe(false);
    expect(canAcceptDeposit(b, true)).toBe(false);
  });

  it("a stored item below still allows a SAME-DAY deposit above", () => {
    // Same-day items are collected from the top and never dropped.
    const b = { ...FREE, bottomStatus: "OCCUPIED" as const };
    expect(canAcceptDeposit(b, false)).toBe(true);
  });

  it("a stored item below REFUSES a long-lead deposit above", () => {
    // It would pass its check with nowhere to be dropped to.
    const b = { ...FREE, bottomStatus: "OCCUPIED" as const };
    expect(canAcceptDeposit(b, true)).toBe(false);
  });

  it("an owner's released item waiting below also refuses a long-lead deposit", () => {
    const b = { ...FREE, bottomStatus: "AWAITING_RETRIEVAL" as const };
    expect(canAcceptDeposit(b, true)).toBe(false);
  });

  it("a bay full in both compartments is locked", () => {
    const b = {
      ...FREE,
      topStatus: "OCCUPIED" as const,
      bottomStatus: "OCCUPIED" as const,
    };
    expect(isFullyOccupied(b)).toBe(true);
    expect(canAcceptDeposit(b, false)).toBe(false);
    expect(canAcceptDeposit(b, true)).toBe(false);
  });
});

describe("deriveLockerStatus — never reports a bay emptier than it is", () => {
  it("both free -> AVAILABLE", () => {
    expect(deriveLockerStatus(FREE)).toBe("AVAILABLE");
  });

  it("not operational wins over everything", () => {
    expect(
      deriveLockerStatus({ ...FREE, topStatus: "OCCUPIED", isOperational: false }),
    ).toBe("OUT_OF_SERVICE");
  });

  it("a stored item below with the top free is NOT reported AVAILABLE", () => {
    // The regression this guards: freeing the top compartment used to write
    // the whole bay AVAILABLE, hiding a student's stored item underneath.
    expect(deriveLockerStatus({ ...FREE, bottomStatus: "OCCUPIED" })).toBe("OCCUPIED");
  });

  it("an item owed to an owner stays visible as AWAITING_RETRIEVAL", () => {
    expect(
      deriveLockerStatus({
        ...FREE,
        topStatus: "OCCUPIED",
        bottomStatus: "AWAITING_RETRIEVAL",
      }),
    ).toBe("AWAITING_RETRIEVAL");
  });

  it("an upper reservation is reported as such", () => {
    expect(deriveLockerStatus({ ...FREE, topStatus: "RESERVED" })).toBe("RESERVED");
  });
});

describe("doorHoldingRental — open the door the item is actually behind", () => {
  it("an item in the upper compartment -> main_door", () => {
    expect(doorHoldingRental({ topRentalId: "r1", bottomRentalId: null }, "r1")).toBe(
      "main_door",
    );
  });

  it("an item in the lower compartment -> bottom_door", () => {
    expect(doorHoldingRental({ topRentalId: null, bottomRentalId: "r1" }, "r1")).toBe(
      "bottom_door",
    );
  });

  it("a rental in neither compartment -> null, so the caller refuses", () => {
    expect(
      doorHoldingRental({ topRentalId: "other", bottomRentalId: "another" }, "r1"),
    ).toBeNull();
  });

  it("never grants a door to someone else's item in a shared bay", () => {
    // Top holds r2, bottom holds r1: r1 must get bottom_door, not main_door.
    expect(doorHoldingRental({ topRentalId: "r2", bottomRentalId: "r1" }, "r1")).toBe(
      "bottom_door",
    );
  });
});
