import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * D-94 — a claim used to commit (rental.status -> ACTIVE, compartment freed,
 * owner notified) at face-verification-APPROVAL time, before the door had
 * ever actually opened. A renter who cancelled after approval but before
 * opening left the database certain the item was collected while it still
 * sat in the compartment — and the next retry read ACTIVE as "returning",
 * opening the wrong (empty) door. Real incident on rental 331ce382, bay 1.
 *
 * completeClaim() is now the ONLY place that commits a claim, called from
 * kioskController.ts's openBay() ("Open Kiosk Now") — the one place that
 * actually sends the open_door command — not from approval.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../lockerCompartments", () => ({
  setCompartment: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../lockerOccupancyService", () => ({
  emitOccupancyForLockerId: jest.fn().mockResolvedValue(undefined),
  emitLockerOccupancy: jest.fn().mockResolvedValue(undefined),
}));

import prisma from "../../config/database";
import { completeClaim } from "../faceVerificationService";
import { setCompartment } from "../lockerCompartments";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const setCompartmentMock = setCompartment as jest.Mock;

function fakeIo() {
  return { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as any;
}

const RENTAL_ID = "rental-1";
const DEPOSIT_LOCKER_ID = "locker-1";

function depositedRental(over: Record<string, unknown> = {}) {
  return {
    id: RENTAL_ID,
    status: "DEPOSITED",
    ownerId: "owner-1",
    renterId: "renter-1",
    item: { title: "Glue Gun" },
    depositLocker: { id: DEPOSIT_LOCKER_ID },
    ...over,
  };
}

describe("completeClaim — commits only once the door has actually opened", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    setCompartmentMock.mockClear();
  });

  it("on the first open: flips status to ACTIVE, frees the right compartment, notifies the owner", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(depositedRental() as never);
    const io = fakeIo();

    await completeClaim(io, RENTAL_ID, "bottom_door");

    expect(prismaMock.rental.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RENTAL_ID },
        data: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
    expect(setCompartmentMock).toHaveBeenCalledWith(
      DEPOSIT_LOCKER_ID,
      "bottom",
      { status: "AVAILABLE", rentalId: null },
    );
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "owner-1", title: "Item Claimed" }),
      }),
    );
    expect(io.to).toHaveBeenCalledWith("user:owner-1");
  });

  it("frees the TOP compartment when the grant's door is main_door", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(depositedRental() as never);
    await completeClaim(fakeIo(), RENTAL_ID, "main_door");
    expect(setCompartmentMock).toHaveBeenCalledWith(
      DEPOSIT_LOCKER_ID,
      "top",
      { status: "AVAILABLE", rentalId: null },
    );
  });

  it("no-ops on a second open of the same grant — does not re-commit or re-notify", async () => {
    // Simulates the door relocking and the renter tapping "Open Kiosk Now"
    // again: the rental is no longer DEPOSITED (the first call already
    // moved it to ACTIVE), so this must be a pure no-op.
    prismaMock.rental.findUnique.mockResolvedValue(
      depositedRental({ status: "ACTIVE" }) as never,
    );

    await completeClaim(fakeIo(), RENTAL_ID, "bottom_door");

    expect(prismaMock.rental.update).not.toHaveBeenCalled();
    expect(setCompartmentMock).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it("does nothing if the rental has no depositLocker on record", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(
      depositedRental({ depositLocker: null }) as never,
    );
    await completeClaim(fakeIo(), RENTAL_ID, "bottom_door");
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });
});
