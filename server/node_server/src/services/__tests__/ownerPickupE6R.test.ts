import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * E6.R (user ruling 2026-09-24) — a passed return is handed back to its owner
 * IN PLACE through the main door, and the rental is COMPLETED only when the
 * owner is let in to take it.
 *
 * Found live as D-107: a return approved at 22:47 was COMPLETED, its R2 drop
 * refused by the 07:00-21:00 window, never retried, and the item sat in bay 2
 * with its owner never told. These run the REAL releaseForOwnerPickup and the
 * REAL retrieve branch of applyFaceVerificationOutcome; only Prisma and the
 * modules that write compartments / send mail are mocked.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
// recordCompartmentAfterCommit is the real composition in miniature: the same
// write through setCompartment, returning whether it landed (E6.T / D-108).
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
jest.mock("../../utils/email", () => ({
  sendRentalCompleted: jest.fn().mockResolvedValue(undefined),
}));

import prisma from "../../config/database";
import { __resetBayActivity, dropUncollectedToLower, releaseForOwnerPickup } from "../retrievalService";
import { applyFaceVerificationOutcome } from "../faceVerificationService";
import { compartmentHolding, setCompartment } from "../lockerCompartments";
import { _clearAllBayAccess, grantBayAccess } from "../kioskBayAccessStore";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const holdingMock = compartmentHolding as jest.Mock;
const setCompartmentMock = setCompartment as jest.Mock;

const RENTAL_ID = "rental-1";
const BAY = { id: "locker-2", lockerNumber: "2", status: "OCCUPIED", isOperational: true, kioskId: "KIOSK-001" };

function fakeIo() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { io: { to } as any, to, emit };
}

describe("releaseForOwnerPickup — in place, nothing moves", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    holdingMock.mockReset();
    setCompartmentMock.mockClear();
  });

  it("recovers the live D-107 case: a COMPLETED rental whose item is still in the return bay", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "COMPLETED",
      ownerId: "owner-1",
      releaseRequestedAt: null,
      item: { title: "Little Hammer" },
      returnLocker: BAY,
    } as never);
    holdingMock.mockResolvedValue("top");
    const { io, to, emit } = fakeIo();

    const out = await releaseForOwnerPickup(io, RENTAL_ID);

    expect(out).toEqual({ released: true, reason: "OWNER_RETURN_PICKUP", lockerNumber: "2" });
    expect(prismaMock.rental.update).toHaveBeenCalledWith({
      where: { id: RENTAL_ID },
      data: expect.objectContaining({
        releaseReason: "OWNER_RETURN_PICKUP",
        releaseRequestedAt: expect.any(Date),
        releasedAt: expect.any(Date),
        retrievalLockerId: "locker-2",
      }),
    });
    expect(setCompartmentMock).toHaveBeenCalledWith("locker-2", "top", {
      status: "AWAITING_RETRIEVAL",
      rentalId: RENTAL_ID,
    });
    // Nothing is commanded: no room but the owner's is ever addressed, and no
    // kiosk:command of any kind goes out.
    expect(to).not.toHaveBeenCalledWith("kiosk:KIOSK-001");
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
    expect(to).toHaveBeenCalledWith("user:owner-1");
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "owner-1", title: "Item ready to collect" }),
    });
  });

  it("is idempotent — a rental already released is left alone", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "VERIFICATION",
      ownerId: "owner-1",
      releaseRequestedAt: new Date(),
      item: { title: "Little Hammer" },
      returnLocker: BAY,
    } as never);
    const { io } = fakeIo();
    const out = await releaseForOwnerPickup(io, RENTAL_ID);
    expect(out.released).toBe(false);
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("refuses rather than guess when neither compartment records the rental", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "VERIFICATION",
      ownerId: "owner-1",
      releaseRequestedAt: null,
      item: { title: "Little Hammer" },
      returnLocker: BAY,
    } as never);
    holdingMock.mockResolvedValue(null);
    const { io } = fakeIo();
    const out = await releaseForOwnerPickup(io, RENTAL_ID);
    expect(out.released).toBe(false);
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

describe("retrieve branch — the owner's pickup is what completes a passed return", () => {
  const released = {
    id: RENTAL_ID,
    itemId: "item-1",
    renterId: "renter-1",
    ownerId: "owner-1",
    releaseRequestedAt: new Date(),
    releasedAt: new Date(),
    retrievedAt: null,
    item: { title: "Little Hammer" },
    renter: { firstName: "Ren", email: "renter@students.uclm.edu.ph" },
    owner: { firstName: "Own", email: "owner@students.uclm.edu.ph" },
    depositLocker: { id: "locker-2", lockerNumber: "2" },
    retrievalLocker: { id: "locker-2", lockerNumber: "2", kioskId: "KIOSK-001" },
  };

  beforeEach(() => {
    mockReset(prismaMock);
    _clearAllBayAccess();
    prismaMock.locker.findUnique.mockResolvedValue({
      topRentalId: RENTAL_ID,
      bottomRentalId: null,
    } as never);
    prismaMock.$transaction.mockResolvedValue([] as never);
  });

  it("opens the MAIN door and completes an approved return", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      ...released,
      status: "VERIFICATION",
      verificationStatus: "APPROVED",
      releaseReason: "OWNER_RETURN_PICKUP",
    } as never);
    const { io, emit } = fakeIo();

    const out = await applyFaceVerificationOutcome({
      io,
      rentalId: RENTAL_ID,
      kioskId: "KIOSK-001",
      confidence: 0.4,
    });

    expect(out.action).toBe("retrieve");
    expect(emit).toHaveBeenCalledWith("kiosk:command", {
      action: "open_door",
      locker_id: 2,
      door: "main_door",
      rental_id: RENTAL_ID,
    });
    expect(prismaMock.rental.update).toHaveBeenCalledWith({
      where: { id: RENTAL_ID },
      data: { status: "COMPLETED", completedAt: expect.any(Date) },
    });
    expect(emit).toHaveBeenCalledWith("rental:completed", { rentalId: RENTAL_ID });
  });

  it("does NOT complete a disputed rental whose item the owner is collecting", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      ...released,
      status: "DISPUTED",
      verificationStatus: "REJECTED",
      releaseReason: "RETURN_DISPUTED",
    } as never);
    const { io } = fakeIo();

    const out = await applyFaceVerificationOutcome({
      io,
      rentalId: RENTAL_ID,
      kioskId: "KIOSK-001",
      confidence: 0.4,
    });

    expect(out.action).toBe("retrieve");
    for (const call of prismaMock.rental.update.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain("COMPLETED");
    }
  });
});

/**
 * E6.S (user ruling 2026-09-24): if the owner never comes, the item drops to
 * the lower compartment so the upper one is free for the next deposit; a bay
 * is only blocked when BOTH compartments are occupied. This is an UNATTENDED
 * actuator stroke, so every guard an unattended stroke has always had applies.
 */
describe("dropUncollectedToLower — the owner never came", () => {
  // 10:00 local: inside the default 07:00-21:00 window.
  const DAYTIME = new Date(2026, 8, 25, 10, 0, 0);
  const LOCAL_2330 = new Date(2026, 8, 24, 23, 30, 0);

  function waiting(releasedHoursAgo: number, now: Date) {
    return {
      id: RENTAL_ID,
      ownerId: "owner-1",
      releaseReason: "OWNER_RETURN_PICKUP",
      releasedAt: new Date(now.getTime() - releasedHoursAgo * 3_600_000),
      retrievedAt: null,
      item: { title: "Little Hammer" },
      retrievalLocker: BAY,
    };
  }

  beforeEach(() => {
    mockReset(prismaMock);
    holdingMock.mockReset();
    setCompartmentMock.mockClear();
    _clearAllBayAccess();
    // Each drop leaves a process-local "drop running" record on its bay; left
    // over, it refuses the next test for the wrong reason and hides the guard
    // that test exists to prove (found by mutation: the grant check survived).
    __resetBayActivity();
    prismaMock.kioskConfig.findUnique.mockResolvedValue(null);
    holdingMock.mockResolvedValue("top");
    prismaMock.locker.findUnique.mockResolvedValue({
      bottomStatus: "AVAILABLE",
      bottomRentalId: null,
    } as never);
  });

  it("drops an item left up top past the grace, in daytime, onto a free lower compartment", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(waiting(2, DAYTIME) as never);
    const { io, to, emit } = fakeIo();

    const out = await dropUncollectedToLower(io, RENTAL_ID, DAYTIME);

    expect(out.released).toBe(true);
    expect(to).toHaveBeenCalledWith("kiosk:KIOSK-001");
    expect(emit).toHaveBeenCalledWith(
      "kiosk:command",
      expect.objectContaining({ action: "drop_item", locker_id: 2, rental_id: RENTAL_ID }),
    );
    // In transit until the Pi acks: the retrieve branch must fail closed.
    expect(prismaMock.rental.update).toHaveBeenCalledWith({
      where: { id: RENTAL_ID },
      data: { releaseRequestedAt: DAYTIME, releasedAt: null },
    });
    expect(setCompartmentMock).toHaveBeenCalledWith("locker-2", "bottom", {
      status: "RESERVED",
      rentalId: RENTAL_ID,
    });
  });

  it("waits out the owner's grace", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(waiting(0.5, DAYTIME) as never);
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, DAYTIME);
    expect(out.released).toBe(false);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });

  it("never strokes unattended at night (F10)", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(waiting(3, LOCAL_2330) as never);
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, LOCAL_2330);
    expect(out.released).toBe(false);
    expect(out.refusal).toMatch(/release window/);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });

  it("does not stack two items: an occupied lower compartment keeps the item up top", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(waiting(2, DAYTIME) as never);
    prismaMock.locker.findUnique.mockResolvedValue({
      bottomStatus: "OCCUPIED",
      bottomRentalId: "someone-else",
    } as never);
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, DAYTIME);
    expect(out.released).toBe(false);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("never strokes while anyone holds a grant on the bay — the owner may be standing at it", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(waiting(2, DAYTIME) as never);
    grantBayAccess({
      rentalId: RENTAL_ID,
      userId: "owner-1",
      kioskId: "KIOSK-001",
      action: "retrieve",
      lockerNumber: "2",
      door: "main_door",
    });
    const { io, emit } = fakeIo();
    const out = await dropUncollectedToLower(io, RENTAL_ID, DAYTIME);
    expect(out.released).toBe(false);
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });
});

describe("releaseForOwnerPickup — a rejected deposit is handed back from the DEPOSIT bay", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    holdingMock.mockReset();
    setCompartmentMock.mockClear();
  });

  it("finds the item in the deposit bay when there is no return bay (R4)", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "CANCELLED",
      ownerId: "owner-1",
      releaseRequestedAt: null,
      item: { title: "Little Hammer" },
      returnLocker: null,
      depositLocker: { ...BAY, id: "locker-1", lockerNumber: "1" },
    } as never);
    holdingMock.mockResolvedValue("top");
    const { io, emit } = fakeIo();

    const out = await releaseForOwnerPickup(io, RENTAL_ID, "DEPOSIT_REJECTED");

    expect(out).toEqual({ released: true, reason: "DEPOSIT_REJECTED", lockerNumber: "1" });
    expect(prismaMock.rental.update).toHaveBeenCalledWith({
      where: { id: RENTAL_ID },
      data: expect.objectContaining({ releaseReason: "DEPOSIT_REJECTED", retrievalLockerId: "locker-1" }),
    });
    expect(emit).not.toHaveBeenCalledWith("kiosk:command", expect.anything());
  });
});

/**
 * D-108 / E6.T — 23:46 on 2026-09-24: the DB dropped right after the retrieve
 * branch opened bay 2, the rest of the branch was skipped, and the owner's
 * phone got HTTP 500 for a pickup that had worked. Once the door has opened,
 * nothing after it may reach the person as a failure.
 */
describe("retrieve branch — a DB drop after the door opens still tells the owner", () => {
  it("emits face:verified and returns retrieve although the compartment write and the completion fail", async () => {
    mockReset(prismaMock);
    _clearAllBayAccess();
    prismaMock.locker.findUnique.mockResolvedValue({ topRentalId: RENTAL_ID, bottomRentalId: null } as never);
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      itemId: "item-1",
      renterId: "renter-1",
      ownerId: "owner-1",
      status: "VERIFICATION",
      verificationStatus: "APPROVED",
      releaseReason: "OWNER_RETURN_PICKUP",
      releaseRequestedAt: new Date(),
      releasedAt: new Date(),
      retrievedAt: null,
      item: { title: "Little Hammer" },
      renter: { firstName: "Ren", email: "r@x" },
      owner: { firstName: "Own", email: "o@x" },
      depositLocker: { id: "locker-2", lockerNumber: "2" },
      retrievalLocker: { id: "locker-2", lockerNumber: "2", kioskId: "KIOSK-001" },
    } as never);
    const { recordCompartmentAfterCommit } = jest.requireMock("../lockerCompartments");
    (recordCompartmentAfterCommit as jest.Mock).mockResolvedValueOnce(false);
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("Server has closed the connection."), { code: "P1017" }),
    );
    const { io, emit } = fakeIo();

    const out = await applyFaceVerificationOutcome({
      io,
      rentalId: RENTAL_ID,
      kioskId: "KIOSK-001",
      confidence: 0.4,
    });

    expect(out.action).toBe("retrieve");
    expect(emit).toHaveBeenCalledWith("kiosk:command", expect.objectContaining({ action: "open_door" }));
    expect(emit).toHaveBeenCalledWith("face:verified", expect.objectContaining({ action: "retrieve" }));
  });
});
