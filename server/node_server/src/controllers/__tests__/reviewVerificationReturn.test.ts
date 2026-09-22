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
}));
jest.mock("../../services/rentalSettlementService", () => ({
  finalizeRentalCompletion: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../services/itemAvailabilityService", () => ({
  recomputeItemAvailability: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../utils/email", () => ({
  sendItemReadyForClaim: jest.fn().mockResolvedValue(undefined),
  sendVerificationFailed: jest.fn().mockResolvedValue(undefined),
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
import { requestRelease } from "../../services/retrievalService";
import { finalizeRentalCompletion } from "../../services/rentalSettlementService";
import { sendVerificationFailed } from "../../utils/email";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const requestReleaseMock = requestRelease as jest.Mock;
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

describe("reviewVerification — return, APPROVED (D-95)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    requestReleaseMock.mockClear();
    finalizeMock.mockClear();
    prismaMock.verification.findUnique.mockResolvedValue({
      id: "verification-1",
      rental: RETURN_RENTAL,
      depositRental: null,
    } as never);
    prismaMock.$transaction.mockResolvedValue([] as never);
  });

  it("releases the item back to the owner BEFORE completing the rental", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());

    expect(requestReleaseMock).toHaveBeenCalledWith(io, "rental-1", {
      reasonOverride: "OWNER_RETURN_PICKUP",
    });
    // The release call must happen before the $transaction that flips
    // status to COMPLETED — after that, requestRelease can no longer tell
    // this bay held the return (see the code comment: reasonForStatus
    // only recognises "VERIFICATION", not "COMPLETED").
    const releaseCallOrder = requestReleaseMock.mock.invocationCallOrder[0];
    const transactionCallOrder = prismaMock.$transaction.mock.invocationCallOrder[0];
    expect(releaseCallOrder).toBeLessThan(transactionCallOrder);
  });

  it("refunds the deposit and pays the owner out", async () => {
    const { io } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(finalizeMock).toHaveBeenCalledWith("rental-1");
  });

  it("emits rental:completed to both the renter and the owner", async () => {
    const { io, to } = makeIo();
    await reviewVerification(makeReq("APPROVED", io), makeRes(), jest.fn());
    expect(to).toHaveBeenCalledWith("user:renter-1");
    expect(to).toHaveBeenCalledWith("user:owner-1");
  });
});

describe("reviewVerification — return, REJECTED (D-95)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    requestReleaseMock.mockClear();
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

    expect(requestReleaseMock).toHaveBeenCalledWith(io, "rental-1", {
      reasonOverride: "RETURN_DISPUTED",
    });
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
