import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * POST /rentals/:id/dispute — the phone's "Dispute this Return".
 *
 * Dispute v2, ruling 2 (2026-10-11): only an ADMIN's Reject opens a case and
 * starts penalties. A student raising a concern no longer flips the rental to
 * DISPUTED or moves the item (E6.S's behaviour, superseded): it puts the
 * concern in front of the admin who decides, on the same review row. Runs the
 * REAL handler; Prisma is mocked.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock("../../services/adminRoom", () => ({ notifyAdmins: jest.fn() }));

import prisma from "../../config/database";
import { fileDispute } from "../rentalController";
import { AuthRequest } from "../../middleware/auth";
import { notifyAdmins } from "../../services/adminRoom";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

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

const io = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };

describe("POST /rentals/:id/dispute (Dispute v2: a concern for the admin, never a penalty)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    (notifyAdmins as jest.Mock).mockClear();
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      status: "VERIFICATION",
      verificationStatus: "MANUAL_REVIEW",
      renterId: "renter-1",
      ownerId: "owner-1",
      verificationId: "verification-1",
      item: { title: "Little Hammer" },
    } as never);
    prismaMock.verification.findUnique.mockResolvedValue({ reviewNotes: "Quick check said RETRY 0" } as never);
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }] as never);
  });

  it("keeps the return in review, records the concern, alerts the admins, and does NOT dispute", async () => {
    const next = jest.fn();
    await fileDispute(makeReq("renter-1", undefined, io), makeRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.rental.update).toHaveBeenCalledWith({
      where: { id: "rental-1" },
      data: { verificationStatus: "MANUAL_REVIEW" },
    });
    expect(JSON.stringify(prismaMock.rental.update.mock.calls)).not.toMatch(/DISPUTED/);
    expect(prismaMock.verification.update).toHaveBeenCalledWith({
      where: { id: "verification-1" },
      data: {
        status: "MANUAL_REVIEW",
        reviewNotes:
          "Quick check said RETRY 0\nConcern raised by the renter: The item was returned in the same condition",
      },
    });
    expect(notifyAdmins).toHaveBeenCalledWith(io, "admin:return_flagged", expect.objectContaining({ rentalId: "rental-1" }));
    expect(prismaMock.notification.createMany).toHaveBeenCalled();
  });

  it("refuses once the return is approved (its money has already moved)", async () => {
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      status: "VERIFICATION",
      verificationStatus: "APPROVED",
      renterId: "renter-1",
      ownerId: "owner-1",
      item: { title: "Little Hammer" },
    } as never);
    const next = jest.fn();
    await fileDispute(makeReq("renter-1", undefined, io), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/still being checked/i);
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not the renter or the owner", async () => {
    const next = jest.fn();
    await fileDispute(makeReq("stranger-1", undefined, io), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const next = jest.fn();
    await fileDispute(makeReq("owner-1", "  ", io), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prismaMock.rental.update).not.toHaveBeenCalled();
  });
});
