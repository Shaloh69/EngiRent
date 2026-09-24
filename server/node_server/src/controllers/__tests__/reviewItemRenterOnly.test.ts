import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * E6.R (user ruling 2026-09-24): only the renter reviews the item. Both phones
 * offered "Leave a Review" at COMPLETED, and the server accepted an ITEM review
 * from the OWNER — who was then rating their own listing into its average.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from "../../config/database";
import { createReview } from "../reviewController";
import { AuthRequest } from "../../middleware/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(userId: string): AuthRequest {
  return {
    user: { userId, email: "a@b.com", studentId: "s1", role: "STUDENT" },
    body: { rentalId: "rental-1", rating: 5, comment: "great", reviewType: "ITEM" },
  } as unknown as AuthRequest;
}

describe("createReview — ITEM reviews are the renter's alone", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.rental.findUnique.mockResolvedValue({
      id: "rental-1",
      status: "COMPLETED",
      itemId: "item-1",
      renterId: "renter-1",
      ownerId: "owner-1",
      item: { title: "Little Hammer" },
    } as never);
    prismaMock.review.findUnique.mockResolvedValue(null);
    prismaMock.review.create.mockResolvedValue({ id: "review-1" } as never);
    prismaMock.review.aggregate.mockResolvedValue({
      _avg: { rating: 5 },
      _count: { rating: 1 },
    } as never);
  });

  it("refuses the OWNER, and never touches the item's rating", async () => {
    const next = jest.fn();
    await createReview(makeReq("owner-1"), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/only the renter/i);
    expect(prismaMock.review.create).not.toHaveBeenCalled();
    expect(prismaMock.item.update).not.toHaveBeenCalled();
  });

  it("accepts the RENTER", async () => {
    const next = jest.fn();
    await createReview(makeReq("renter-1"), makeRes(), next);
    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.review.create).toHaveBeenCalled();
  });
});
