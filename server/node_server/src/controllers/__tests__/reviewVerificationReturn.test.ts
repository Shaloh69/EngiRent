import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * D-95 — a return verification decided by admin review (the NORMAL path,
 * since D-87b made the fast ML tier structurally unable to approve on its
 * own) never released the item back to the owner, and on approval never
 * refunded the deposit or paid the owner out either. Both requestRelease()
 * and finalizeRentalCompletion() are fully built, tested, already used by
 * the automatic (index.ts completeRental) and dispute (settleDispute) paths
 * — this function just never called either. Found live: rental 331ce382
 * completed this way with a real ₱500 deposit / ₱90 rental payment on
 * record and zero DEPOSIT_REFUND/OWNER_PAYOUT rows, and its own item never
 * left the bay for lack of a single requestRelease() call.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../../services/retrievalService", () => ({
  requestRelease: jest.fn().mockResolvedValue({ released: true }),
  releaseForOwnerPickup: jest.fn().mockResolvedValue({ released: true, lockerNumber: "2" }),
  // Ruling 2026-10-10: a rejected return is released AND dropped to the lower compartment.
  releaseDisputedItem: jest.fn().mockResolvedValue({ released: true, lockerNumber: "2" }),
}));
jest.mock("../../services/rentalSettlementService", () => ({
  finalizeRentalCompletion: jest.fn().mockResolvedValue(undefined),
  refundRenterInFull: jest.fn().mockResolvedValue(50),
}));
jest.mock("../../services/itemAvailabilityService", () => ({
  recomputeItemAvailability: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../utils/email", () => ({
  sendItemReadyForClaim: jest.fn().mockResolvedValue(undefined),
  sendVerificationFailed: jest.fn().mockResolvedValue(undefined),
  sendRentalCompleted: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../services/storageDropService", () => ({
  dropToStorage: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/auditLogService", () => ({
  recordAudit: jest.fn().mockResolvedValue(undefined),
}));

import prisma from "../../config/database";
import { reviewVerification } from "../adminController";
import { AuthRequest } from "../../middleware/auth";
import { releaseDisputedItem, releaseForOwnerPickup, requestRelease } from "../../services/retrievalService";
import { recomputeItemAvailability } from "../../services/itemAvailabilityService";
import { finalizeRentalCompletion, refundRenterInFull } from "../../services/rentalSettlementService";
import { sendVerificationFailed } from "../../utils/email";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const requestReleaseMock = requestRelease as jest.Mock;
const releaseForPickupMock = releaseForOwnerPickup as jest.Mock;
const releaseDisputedMock = releaseDisputedItem as jest.Mock;
const finalizeMock = finalizeRentalCompletion as jest.Mock;
const sendVerificationFailedMock = sendVerificationFailed as jest.Mock;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeIo() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { io: { to }, to, emit };
}

function makeReq(status: "APPROVED" | "REJECTED", io: unknown): AuthRequest {
  return {
    params: { id: "verification-1" },
    body: { status },
    user: { userId: "admin-1", email: "admin@engirent.edu.ph", studentId: "a1", role: "ADMIN" },
    app: { get: (k: string) => (k === "io" ? io : undefined) },
  } as unknown as AuthRequest;
}

const RETURN_RENTAL = {
  id: "rental-1",
  status: "VERIFICATION",
  itemId: "item-1",
  renterId: "renter-1",
  ownerId: "owner-1",
  item: { title: "Glue Gun" },
};

/**
 * E6.R (user ruling 2026-09-24) — approval settles the money and hands the item
 * back to its owner IN PLACE; the rental is completed only when the owner opens
 * the bay and takes it. Runs the REAL returnApprovalService behind the REAL
 * reviewVerification; only Prisma, the executor and PayMongo are mocked.
 */
describe("reviewVerification — return, APPROVED (D-95 + E6.R)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    requestReleaseMock.mockClear();
    releaseForPickupMock.mockClear();
    finalizeMock.mockClear();
    prismaMock.verification.findUnique.mockResolvedValue({
      id: "verification-1",
      rental: { ...RETURN_RENTAL, verificationStatus: "MANUAL_REVIEW" },
      depositRental: null,
    } as never);
    prismaMock.rental.findUnique.mockResolvedValue(RETURN_RENTAL as never);
    prismaMock.transaction.count.mockResolvedValue(0 as never);
    prismaMock.$transaction.mockResolvedValue([] as never);
  });

  it("hands the item back to the owner IN PLACE and never requests a drop", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(releaseForPickupMock).toHaveBeenCalledWith(io, "rental-1");
    expect(requestReleaseMock).not.toHaveBeenCalled();
  });

  it("refunds the deposit and pays the owner out at approval (D-95)", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(finalizeMock).toHaveBeenCalledWith("rental-1");
  });

  it("does NOT complete the rental — it stays in VERIFICATION until the owner collects", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(prismaMock.rental.update).toHaveBeenCalledWith({
      where: { id: "rental-1" },
      data: { verificationStatus: "APPROVED" },
    });
    for (const call of prismaMock.rental.update.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain("COMPLETED");
    }
  });

  it("tells the renter the return is approved, and does not announce completion", async () => {
    const { io, to, emit } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(to).toHaveBeenCalledWith("user:renter-1");
    expect(emit).toHaveBeenCalledWith("return:approved", { rentalId: "rental-1" });
    expect(emit).not.toHaveBeenCalledWith("rental:completed", expect.anything());
  });

  it("never settles twice: a second approval of an already-approved return does nothing", async () => {
    prismaMock.verification.findUnique.mockResolvedValue({
      id: "verification-1",
      rental: { ...RETURN_RENTAL, verificationStatus: "APPROVED" },
      depositRental: null,
    } as never);
    const { io } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(releaseForPickupMock).not.toHaveBeenCalled();
  });

  it("a late REJECTED cannot dispute a return whose money has already moved", async () => {
    prismaMock.verification.findUnique.mockResolvedValue({
      id: "verification-1",
      rental: { ...RETURN_RENTAL, verificationStatus: "APPROVED" },
      depositRental: null,
    } as never);
    const { io } = makeIo();
    await reviewVerification(makeReq("REJECTED", io), makeRes(), jest.fn());
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
    expect(requestReleaseMock).not.toHaveBeenCalled();
  });
});

describe("reviewVerification — return, REJECTED (D-95)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    requestReleaseMock.mockClear();
    releaseForPickupMock.mockClear();
    releaseDisputedMock.mockClear();
    (recomputeItemAvailability as jest.Mock).mockClear();
    sendVerificationFailedMock.mockClear();
    prismaMock.verification.findUnique.mockResolvedValue({
      id: "verification-1",
      rental: RETURN_RENTAL,
      depositRental: null,
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({
      email: "renter@students.uclm.edu.ph",
      firstName: "Renter",
    } as never);
  });

  it("releases the disputed item back to the owner, and tells both parties", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("REJECTED", io), makeRes(), jest.fn());

    // Ruling 2026-10-10 (after E6.S): released AND dropped to the lower compartment at
    // once, at any hour, through ONE function. Neither the old in-place-only call nor
    // the policy-gated requestRelease may be used for it.
    expect(releaseDisputedMock).toHaveBeenCalledWith(io, "rental-1");
    expect(releaseForPickupMock).not.toHaveBeenCalledWith(io, "rental-1", "RETURN_DISPUTED");
    expect(requestReleaseMock).not.toHaveBeenCalled();
    // D-115: the listing stays blocked while the dispute is open.
    expect(recomputeItemAvailability).toHaveBeenCalledWith("item-1");
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "owner-1", title: "Return Disputed" }),
      }),
    );
    expect(sendVerificationFailedMock).toHaveBeenCalledWith(
      "renter@students.uclm.edu.ph",
      expect.objectContaining({ rentalId: "rental-1", reason: "return" }),
    );
  });

  it("still marks the rental DISPUTED even if requestRelease refuses (bay busy, etc.)", async () => {
    requestReleaseMock.mockResolvedValueOnce({ released: false, refusal: "bay_busy" });
    const { io } = makeIo();
    await reviewVerification(makeReq("REJECTED", io), makeRes(), jest.fn());
    expect(prismaMock.rental.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rental-1" },
        data: { status: "DISPUTED", verificationStatus: "REJECTED" },
      }),
    );
  });
});

/**
 * E6.V (user ruling 2026-09-25, D-109): the OWNER deposited the wrong item (the
 * rivet tool in place of the screwdriver, rental 1125ad66) and the admin
 * rejected it. The rental was cancelled and the renter's money stayed COMPLETED.
 */
describe("reviewVerification — deposit, REJECTED (E6.V)", () => {
  it("cancels, hands the item back to the owner, and refunds the renter in full", async () => {
    mockReset(prismaMock);
    releaseForPickupMock.mockClear();
    (refundRenterInFull as jest.Mock).mockClear();
    prismaMock.verification.findUnique.mockResolvedValue({
      id: "verification-1",
      rental: null,
      depositRental: {
        id: "rental-9",
        status: "DEPOSITED",
        itemId: "item-9",
        renterId: "renter-1",
        ownerId: "owner-1",
        item: { title: "Phillip Screw Driver" },
      },
    } as never);
    const { io } = makeIo();

    await reviewVerification(makeReq("REJECTED", io), makeRes(), jest.fn());

    expect(prismaMock.rental.update).toHaveBeenCalledWith({
      where: { id: "rental-9" },
      data: { status: "CANCELLED", verificationStatus: "REJECTED" },
    });
    expect(releaseForPickupMock).toHaveBeenCalledWith(io, "rental-9", "DEPOSIT_REJECTED");
    expect(refundRenterInFull).toHaveBeenCalledWith("rental-9", expect.stringContaining("did not match"));
  });
});
