import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

/**
 * D-94 regression test, at the point the bug actually lived: the CLAIM
 * branch of applyFaceVerificationOutcome must only GRANT bay access, never
 * commit rental.status/claimedAt, free the compartment, or notify the
 * owner — that's completeClaim()'s job now, run from the actual door-open
 * tap. If this branch starts writing that state again, D-94 is back.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { applyFaceVerificationOutcome } from "../faceVerificationService";
import { _clearAllBayAccess, getBayAccess } from "../kioskBayAccessStore";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function fakeIo() {
  return { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as any;
}

const RENTAL_ID = "rental-1";

describe("applyFaceVerificationOutcome — claim branch grants, does not commit", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    _clearAllBayAccess();
    // Dispute v2 (ruling 1 + 3): a claim needs a verified, unrestricted renter.
    prismaMock.user.findUnique.mockResolvedValue({ isVerified: true, restrictedUntilReviewAt: null } as never);
    prismaMock.dispute.findFirst.mockResolvedValue(null);
  });

  it("refuses a claim by an unverified renter (ruling 1: UCLM-verified students only)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isVerified: false, restrictedUntilReviewAt: null } as never);
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "DEPOSITED",
      verificationStatus: "APPROVED",
      renterId: "renter-1",
      ownerId: "owner-1",
      item: { title: "Glue Gun" },
      depositLocker: { id: "locker-1", lockerNumber: "1" },
      retrievalLocker: null,
      releaseRequestedAt: null,
      retrievedAt: null,
    } as never);
    const result = await applyFaceVerificationOutcome({ io: fakeIo(), rentalId: RENTAL_ID, kioskId: "KIOSK-001", confidence: 50 });
    expect(result.action).toBe("none");
    expect(result.error).toMatch(/University of Cebu Lapu-Lapu and Mandaue/);
    expect(getBayAccess(RENTAL_ID)).toBeUndefined();
  });

  it("refuses a claim while the renter has an open dispute (ruling 3)", async () => {
    prismaMock.dispute.findFirst.mockResolvedValue({ id: "d-1", referenceNo: "ER-DSP-2026-0001" } as never);
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "DEPOSITED",
      verificationStatus: "APPROVED",
      renterId: "renter-1",
      ownerId: "owner-1",
      item: { title: "Glue Gun" },
      depositLocker: { id: "locker-1", lockerNumber: "1" },
      retrievalLocker: null,
      releaseRequestedAt: null,
      retrievedAt: null,
    } as never);
    const result = await applyFaceVerificationOutcome({ io: fakeIo(), rentalId: RENTAL_ID, kioskId: "KIOSK-001", confidence: 50 });
    expect(result.action).toBe("none");
    expect(result.error).toMatch(/ER-DSP-2026-0001/);
  });

  it("grants bottom_door access without touching rental status or the compartment", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "DEPOSITED",
      verificationStatus: "APPROVED",
      renterId: "renter-1",
      ownerId: "owner-1",
      item: { title: "Glue Gun" },
      depositLocker: { id: "locker-1", lockerNumber: "1" },
      retrievalLocker: null,
      releaseRequestedAt: null,
      retrievedAt: null,
    } as never);
    prismaMock.locker.findUnique.mockResolvedValue({
      id: "locker-1",
      lockerNumber: "1",
      topRentalId: null,
      bottomRentalId: RENTAL_ID,
    } as never);

    const result = await applyFaceVerificationOutcome({
      io: fakeIo(),
      rentalId: RENTAL_ID,
      kioskId: "KIOSK-001",
      confidence: 50,
    });

    expect(result.action).toBe("claim");
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();

    const grant = getBayAccess(RENTAL_ID);
    expect(grant?.action).toBe("claim");
    expect(grant?.door).toBe("bottom_door");
  });

  it("refuses (does not grant) when neither compartment holds this rental", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: RENTAL_ID,
      status: "DEPOSITED",
      verificationStatus: "APPROVED",
      renterId: "renter-1",
      ownerId: "owner-1",
      item: { title: "Glue Gun" },
      depositLocker: { id: "locker-1", lockerNumber: "1" },
      retrievalLocker: null,
      releaseRequestedAt: null,
      retrievedAt: null,
    } as never);
    prismaMock.locker.findUnique.mockResolvedValue({
      id: "locker-1",
      lockerNumber: "1",
      topRentalId: "some-other-rental",
      bottomRentalId: null,
    } as never);

    const result = await applyFaceVerificationOutcome({
      io: fakeIo(),
      rentalId: RENTAL_ID,
      kioskId: "KIOSK-001",
      confidence: 50,
    });

    expect(result.action).toBe("none");
    expect(getBayAccess(RENTAL_ID)).toBeUndefined();
  });
});
