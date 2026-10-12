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
// Dispute v2: an admin's Reject opens a case (the case logic has its own tests).
jest.mock("../../services/disputeService", () => ({
  openDispute: jest.fn().mockResolvedValue({ id: "dispute-1", referenceNo: "ER-DSP-2026-0001", offense: 1 }),
  onDisputeReturnApproved: jest.fn().mockResolvedValue(undefined),
}));

import prisma from "../../config/database";
import { reviewVerification } from "../adminController";
import { AuthRequest } from "../../middleware/auth";
import { releaseDisputedItem, releaseForOwnerPickup, requestRelease } from "../../services/retrievalService";
import { finalizeRentalCompletion, refundRenterInFull } from "../../services/rentalSettlementService";
import { sendVerificationFailed } from "../../utils/email";
import { openDispute } from "../../services/disputeService";

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

  it("settles at approval (D-95): the owner is paid, the deposit is HELD for the owner's damage check (Concerns v2)", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(finalizeMock).toHaveBeenCalledWith("rental-1", { holdDeposit: true });
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

  it("never settles twice: a second approval of an already-approved AND settled return does nothing", async () => {
    prismaMock.transaction.count.mockResolvedValue(2 as never); // refund + payout rows exist
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

  it("approved but NEVER settled (the 2026-10-12 database drop): a repeat approval finishes the job", async () => {
    prismaMock.transaction.count.mockResolvedValue(0 as never); // the settlement never ran
    prismaMock.verification.findUnique.mockResolvedValue({
      id: "verification-1",
      rental: { ...RETURN_RENTAL, verificationStatus: "APPROVED" },
      depositRental: null,
    } as never);
    const { io } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });

  it("a late REJECTED cannot dispute a return that was approved, settled or not", async () => {
    prismaMock.transaction.count.mockResolvedValue(0 as never);
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

describe("reviewVerification — return, REJECTED (Dispute v2, ruling 2)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    requestReleaseMock.mockClear();
    releaseForPickupMock.mockClear();
    releaseDisputedMock.mockClear();
    (openDispute as jest.Mock).mockClear();
    sendVerificationFailedMock.mockClear();
    prismaMock.verification.findUnique.mockResolvedValue({
      id: "verification-1",
      rental: RETURN_RENTAL,
      depositRental: null,
    } as never);
  });

  it("opens a Dispute v2 case: the ONLY trigger for penalties is this admin click", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("REJECTED", io), makeRes(), jest.fn());
    expect(openDispute).toHaveBeenCalledWith(
      io,
      expect.objectContaining({ rentalId: "rental-1", verificationId: "verification-1", adminId: "admin-1" }),
    );
  });

  it("no longer hands the wrong item to the OWNER (ruling 8: the renter collects it)", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("REJECTED", io), makeRes(), jest.fn());
    expect(releaseDisputedMock).not.toHaveBeenCalled();
    expect(releaseForPickupMock).not.toHaveBeenCalled();
    expect(requestReleaseMock).not.toHaveBeenCalled();
  });

  it("passes the admin's deadline choice through (ruling 4)", async () => {
    const { io } = makeIo();
    const req = makeReq("REJECTED", io);
    (req.body as Record<string, unknown>).deadlineHours = 48;
    await reviewVerification(req, makeRes(), jest.fn());
    expect(openDispute).toHaveBeenCalledWith(io, expect.objectContaining({ deadlineHours: 48 }));
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
