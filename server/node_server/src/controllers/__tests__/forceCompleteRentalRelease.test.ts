import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * D-95 — forceCompleteRental is the admin escape hatch for a stuck rental,
 * usable from VERIFICATION or DISPUTED. That is exactly when the item is
 * most likely to still be sitting un-released in the bay, and it never
 * called requestRelease() or finalizeRentalCompletion() either — the same
 * gap as reviewVerification()'s return-approval path, in the tool most
 * likely to be reached for precisely when something upstream already
 * failed to release the item.
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

import prisma from "../../config/database";
import { forceCompleteRental } from "../adminController";
import { AuthRequest } from "../../middleware/auth";
import { requestRelease } from "../../services/retrievalService";
import { finalizeRentalCompletion } from "../../services/rentalSettlementService";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const requestReleaseMock = requestRelease as jest.Mock;
const finalizeMock = finalizeRentalCompletion as jest.Mock;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeIo() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { io: { to }, to };
}

function makeReq(rentalId: string, io: unknown): AuthRequest {
  return {
    params: { id: rentalId },
    body: {},
    user: { userId: "admin-1", email: "admin@engirent.edu.ph", studentId: "a1", role: "ADMIN" },
    app: { get: (k: string) => (k === "io" ? io : undefined) },
  } as unknown as AuthRequest;
}

function rentalFixture(status: "VERIFICATION" | "DISPUTED") {
  return {
    id: "rental-1",
    status,
    itemId: "item-1",
    renterId: "renter-1",
    ownerId: "owner-1",
    item: { title: "Glue Gun" },
  };
}

describe("forceCompleteRental — releases the item and settles money (D-95)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    requestReleaseMock.mockClear();
    finalizeMock.mockClear();
    prismaMock.$transaction.mockResolvedValue([] as never);
  });

  it("from VERIFICATION: calls requestRelease with no override, before completing", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(rentalFixture("VERIFICATION") as never);
    const { io } = makeIo();

    await forceCompleteRental(makeReq("rental-1", io), makeRes(), jest.fn());

    // No reasonOverride: reasonForStatus() derives it from the real status,
    // which handles both entry statuses (VERIFICATION/DISPUTED) correctly
    // without this caller having to know which one it is.
    expect(requestReleaseMock).toHaveBeenCalledWith(io, "rental-1");
    const releaseOrder = requestReleaseMock.mock.invocationCallOrder[0];
    const txOrder = prismaMock.$transaction.mock.invocationCallOrder[0];
    expect(releaseOrder).toBeLessThan(txOrder);
  });

  it("from DISPUTED: still calls requestRelease (a safe no-op if already released)", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(rentalFixture("DISPUTED") as never);
    const { io } = makeIo();

    await forceCompleteRental(makeReq("rental-1", io), makeRes(), jest.fn());

    expect(requestReleaseMock).toHaveBeenCalledWith(io, "rental-1");
  });

  it("refunds the deposit and pays the owner out", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(rentalFixture("VERIFICATION") as never);
    const { io } = makeIo();

    await forceCompleteRental(makeReq("rental-1", io), makeRes(), jest.fn());

    expect(finalizeMock).toHaveBeenCalledWith("rental-1");
  });

  it("emits rental:completed to both parties", async () => {
    prismaMock.rental.findUnique.mockResolvedValue(rentalFixture("VERIFICATION") as never);
    const { io, to } = makeIo();

    await forceCompleteRental(makeReq("rental-1", io), makeRes(), jest.fn());

    expect(to).toHaveBeenCalledWith("user:renter-1");
    expect(to).toHaveBeenCalledWith("user:owner-1");
  });
});
