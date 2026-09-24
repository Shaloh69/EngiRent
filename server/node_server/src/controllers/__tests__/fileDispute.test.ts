import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * E6.S (user ruling 2026-09-24: "wire Dispute this Return"). The phone has
 * always posted to POST /rentals/:id/dispute and the route did not exist, so
 * every dispute failed. Runs the REAL handler; Prisma and the executor are
 * mocked.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../../services/retrievalService", () => ({
  releaseForOwnerPickup: jest.fn().mockResolvedValue({ released: true, lockerNumber: "2" }),
}));

import prisma from "../../config/database";
import { fileDispute } from "../rentalController";
import { AuthRequest } from "../../middleware/auth";
import { releaseForOwnerPickup } from "../../services/retrievalService";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const releaseMock = releaseForOwnerPickup as jest.Mock;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(userId: string, reason = "The item was returned in the same condition", io?: unknown) {
  return {
    user: { userId, email: "a@b.com", studentId: "s1", role: "STUDENT" },
    params: { id: "rental-1" },
    body: { reason },
    app: { get: (k: string) => (k === "io" ? io : undefined) },
  } as unknown as AuthRequest;
}

function makeIo() {
  const emit = jest.fn();
  return { to: jest.fn().mockReturnValue({ emit }) };
}

describe("POST /rentals/:id/dispute", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    releaseMock.mockClear();
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      renterId: "renter-1",
      ownerId: "owner-1",
      verificationId: "verification-1",
      item: { title: "Little Hammer" },
    } as never);
    prismaMock.rental.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.verification.findUnique.mockResolvedValue({ reviewNotes: "Quick check said RETRY 0" } as never);
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }] as never);
  });

  it("disputes a return still under review: DISPUTED, reason kept, item handed back to the owner", async () => {
    const io = makeIo();
    const next = jest.fn();
    await fileDispute(makeReq("renter-1", undefined, io), makeRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.rental.updateMany).toHaveBeenCalledWith({
      where: { id: "rental-1", status: "VERIFICATION", verificationStatus: { not: "APPROVED" } },
      data: { status: "DISPUTED" },
    });
    expect(prismaMock.verification.update).toHaveBeenCalledWith({
      where: { id: "verification-1" },
      data: {
        reviewNotes:
          "Quick check said RETRY 0\nDispute filed by the renter: The item was returned in the same condition",
      },
    });
    expect(releaseMock).toHaveBeenCalledWith(io, "rental-1", "RETURN_DISPUTED");
    expect(prismaMock.notification.createMany).toHaveBeenCalled();
  });

  it("refuses once the return is approved (its money has already moved)", async () => {
    prismaMock.rental.updateMany.mockResolvedValue({ count: 0 } as never);
    const next = jest.fn();
    await fileDispute(makeReq("renter-1", undefined, makeIo()), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/still being checked/i);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not the renter or the owner", async () => {
    const next = jest.fn();
    await fileDispute(makeReq("stranger-1", undefined, makeIo()), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.updateMany).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const next = jest.fn();
    await fileDispute(makeReq("owner-1", "  ", makeIo()), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.updateMany).not.toHaveBeenCalled();
  });
});
