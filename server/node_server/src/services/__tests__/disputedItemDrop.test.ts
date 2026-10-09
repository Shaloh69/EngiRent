import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * User ruling 2026-10-10 — a DISPUTED item goes down to the lower compartment at
 * once, at any hour, so the top door is free for the next check; a bay is only
 * full when both compartments hold something.
 *
 * Found by the first physical test of the v2 item check: a wrong tool returned
 * as Hand Rivets was rejected, the rental went DISPUTED and the item stayed in
 * bay 1's upper compartment "for the owner to collect", with the 1 h grace and
 * the 07:00-21:00 window deciding when it would ever move.
 *
 * These run the REAL dropUncollectedToLower and releaseDisputedItem; only Prisma
 * and the modules that write compartments / broadcast occupancy are mocked
 * (the same harness as ownerPickupE6R.test.ts).
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../lockerCompartments", () => {
  const setCompartment = jest.fn().mockResolvedValue(undefined);
  return {
    compartmentHolding: jest.fn(),
    setCompartment,
    recordCompartmentAfterCommit: jest.fn(async (...args: unknown[]) => {
      await (setCompartment as (...a: unknown[]) => Promise<void>)(...args);
      return true;
    }),
  };
});
jest.mock("../lockerOccupancyService", () => ({
  emitOccupancyForLockerId: jest.fn().mockResolvedValue(undefined),
  emitLockerOccupancy: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../itemAvailabilityService", () => ({
  recomputeItemAvailability: jest.fn().mockResolvedValue(undefined),
}));

import prisma from "../../config/database";
import {
  __resetBayActivity,
  dropUncollectedToLower,
  releaseDisputedItem,
} from "../retrievalService";
import { compartmentHolding, setCompartment } from "../lockerCompartments";
import { _clearAllBayAccess, grantBayAccess } from "../kioskBayAccessStore";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const holdingMock = compartmentHolding as jest.Mock;
const setCompartmentMock = setCompartment as jest.Mock;

const RENTAL_ID = "rental-1";
const BAY = { id: "locker-1", lockerNumber: "1", status: "OCCUPIED", isOperational: true, kioskId: "KIOSK-001" };
const NIGHT = new Date(2026, 9, 10, 1, 1, 0); // 01:01 local: outside 07:00-21:00 (the real incident hour)

function fakeIo() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { io: { to } as any, to, emit };
}

/** A rental that has just been released in place; `reason` decides which rule applies. */
function justReleased(reason: string, now: Date) {
  return {
    id: RENTAL_ID,
    ownerId: "owner-1",
    releaseReason: reason,
    releasedAt: new Date(now.getTime() - 20_000), // 20 seconds ago: well inside any grace
    retrievedAt: null,
    item: { title: "Hand Rivets" },
    retrievalLocker: BAY,
  };
}

describe("dropUncollectedToLower — a DISPUTED item drops at once", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    holdingMock.mockReset();
    setCompartmentMock.mockClear();
    _clearAllBayAccess();
    __resetBayActivity();
    prismaMock.kioskConfig.findUnique.mockResolvedValue(null);
    holdingMock.mockResolvedValue("top");
    prismaMock.locker.findUnique.mockResolvedValue({ bottomStatus: "AVAILABLE", bottomRentalId: null } as never);
  });

  it("drops a disputed item at 01:01 with no grace: the exact incident, now moving", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(justReleased("RETURN_DISPUTED", NIGHT) as never);
    const { io, emit } = fakeIo();

    const out = await dropUncollectedToLower(io, RENTAL_ID, NIGHT);

    expect(out.released).toBe(true);
    expect(emit).toHaveBeenCalledWith(
      "kiosk:command",
      expect.objectContaining({ action: "drop_item", locker_id: 1, rental_id: RENTAL_ID }),
    );
    expect(setCompartmentMock).toHaveBeenCalledWith("locker-1", "bottom", { status: "RESERVED", rentalId: RENTAL_ID });
  });

  it("tells the owner it is under dispute, not that they forgot to collect it", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(justReleased("RETURN_DISPUTED", NIGHT) as never);
    const { io } = fakeIo();
    await dropUncollectedToLower(io, RENTAL_ID, NIGHT);
    const msg = (prismaMock.notification.create.mock.calls[0][0] as any).data.message as string;
    expect(msg).toMatch(/under dispute/);
    expect(msg).not.toMatch(/was not collected/);
  });

  it("leaves every OTHER release on the old rules: grace still applies", async () => {
    const day = new Date(2026, 9, 10, 10, 0, 0);
    prismaMock.rental.findUnique.mockResolvedValue(justReleased("OWNER_RETURN_PICKUP", day) as never);
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, day);
    expect(out.released).toBe(false);
    expect(out.refusal).toMatch(/grace/);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });

  it("leaves every OTHER release on the old rules: the night window still applies", async () => {
    const rental = { ...justReleased("OWNER_RETURN_PICKUP", NIGHT), releasedAt: new Date(NIGHT.getTime() - 3 * 3_600_000) };
    prismaMock.rental.findUnique.mockResolvedValue(rental as never);
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, NIGHT);
    expect(out.released).toBe(false);
    expect(out.refusal).toMatch(/release window/);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });

  it("still never strokes while anyone holds a grant on the bay", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(justReleased("RETURN_DISPUTED", NIGHT) as never);
    grantBayAccess({
      rentalId: RENTAL_ID,
      userId: "owner-1",
      kioskId: "KIOSK-001",
      action: "retrieve",
      lockerNumber: "1",
      door: "main_door",
    });
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, NIGHT);
    expect(out.released).toBe(false);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });

  it("still does not stack two items: an occupied lower compartment keeps the disputed item up top", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(justReleased("RETURN_DISPUTED", NIGHT) as never);
    prismaMock.locker.findUnique.mockResolvedValue({ bottomStatus: "OCCUPIED", bottomRentalId: "someone-else" } as never);
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, NIGHT);
    expect(out.released).toBe(false);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });

  it("still respects a bay that is out of service", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      ...justReleased("RETURN_DISPUTED", NIGHT),
      retrievalLocker: { ...BAY, isOperational: false },
    } as never);
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, NIGHT);
    expect(out.released).toBe(false);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });
});

describe("releaseDisputedItem — release in place, then drop", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    holdingMock.mockReset();
    setCompartmentMock.mockClear();
    _clearAllBayAccess();
    __resetBayActivity();
    prismaMock.kioskConfig.findUnique.mockResolvedValue(null);
    holdingMock.mockResolvedValue("top");
    prismaMock.locker.findUnique.mockResolvedValue({ bottomStatus: "AVAILABLE", bottomRentalId: null } as never);
  });

  /** findUnique is read by BOTH steps: first the pre-release row, then the released one. */
  function sequence(...rows: unknown[]) {
    let i = 0;
    prismaMock.rental.findUnique.mockImplementation((() => Promise.resolve(rows[Math.min(i++, rows.length - 1)])) as never);
  }

  const preRelease = {
    id: RENTAL_ID,
    status: "DISPUTED",
    ownerId: "owner-1",
    releaseRequestedAt: null,
    item: { title: "Hand Rivets" },
    returnLocker: BAY,
    depositLocker: BAY,
  };

  it("hands the item to the owner in place and then drops it, whatever the hour", async () => {
    // Real time is not NIGHT, so pin the clock: Date is read inside dropUncollectedToLower.
    jest.useFakeTimers({ now: NIGHT });
    try {
      sequence(preRelease, justReleased("RETURN_DISPUTED", NIGHT));
      const { io, emit } = fakeIo();

      const out = await releaseDisputedItem(io, RENTAL_ID);

      expect(prismaMock.rental.update).toHaveBeenCalledWith({
        where: { id: RENTAL_ID },
        data: expect.objectContaining({ releaseReason: "RETURN_DISPUTED" }),
      });
      expect(emit).toHaveBeenCalledWith("kiosk:command", expect.objectContaining({ action: "drop_item" }));
      expect(out.released).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("when the drop is refused, the item stays collectable in place and nothing throws", async () => {
    jest.useFakeTimers({ now: NIGHT });
    try {
      sequence(preRelease, justReleased("RETURN_DISPUTED", NIGHT));
      prismaMock.locker.findUnique.mockResolvedValue({ bottomStatus: "OCCUPIED", bottomRentalId: "x" } as never);
      const { io, emit } = fakeIo();

      const out = await releaseDisputedItem(io, RENTAL_ID);

      expect(out.released).toBe(true); // the in-place release stands
      expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.objectContaining({ action: "drop_item" }));
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not drop anything when the item cannot be found in either compartment", async () => {
    sequence(preRelease);
    holdingMock.mockResolvedValue(null);
    const { io, emit } = fakeIo();
    const out = await releaseDisputedItem(io, RENTAL_ID);
    expect(out.released).toBe(false);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });
});
