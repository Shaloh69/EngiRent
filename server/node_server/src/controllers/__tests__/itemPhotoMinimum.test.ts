import { mockDeep, DeepMockProxy, mockReset } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";
import { Response } from "express";

/**
 * D-89 — a listing needs at least 3 photos, and the SERVER enforces it.
 *
 * The app enforces the same minimum, but that is a courtesy: a client cannot be
 * trusted to have one, and older app builds do not know it exists. Found via
 * the second physical test, where a correct glue gun scored ~53 partly because
 * one of its two listing photos showed the other side of it.
 */

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
// updateItem kicks off a background ML feature extraction when photos change;
// it is fire-and-forget and irrelevant here.
jest.mock("axios");

import prisma from "../../config/database";
import { updateItem } from "../itemController";
import { AuthRequest } from "../../middleware/auth";
import { MIN_ITEM_PHOTOS, tooFewPhotosMessage } from "../../utils/itemPhotoRules";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function updateReq(body: Record<string, unknown>): AuthRequest {
  return {
    params: { id: "item-1" },
    body,
    user: { userId: "owner-1", email: "o@x.com", studentId: "s1", role: "STUDENT" },
  } as unknown as AuthRequest;
}

describe("the minimum itself", () => {
  it("is three", () => {
    expect(MIN_ITEM_PHOTOS).toBe(3);
  });

  it("says exactly how many more are needed", () => {
    expect(tooFewPhotosMessage(0)).toMatch(/Add 3 more photos/);
    expect(tooFewPhotosMessage(1)).toMatch(/Add 2 more photos/);
    expect(tooFewPhotosMessage(2)).toMatch(/Add 1 more photo:/); // singular
  });
});

describe("updateItem — photos may not be edited down below the minimum", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.item.findUnique.mockResolvedValue({
      id: "item-1",
      ownerId: "owner-1",
      images: ["a", "b", "c"],
    } as never);
    prismaMock.item.update.mockResolvedValue({ id: "item-1", owner: {} } as never);
  });

  it.each([[[]], [["one"]], [["one", "two"]]])(
    "rejects a replacement set of %j",
    async (images) => {
      const next = jest.fn();
      await updateItem(updateReq({ images }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(prismaMock.item.update).not.toHaveBeenCalled();
    },
  );

  it("rejects `images` that is not an array at all", async () => {
    const next = jest.fn();
    await updateItem(updateReq({ images: "just-one.jpg" }), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(prismaMock.item.update).not.toHaveBeenCalled();
  });

  it("accepts a replacement set that meets the minimum", async () => {
    const next = jest.fn();
    await updateItem(updateReq({ images: ["a", "b", "c"] }), makeRes(), next);
    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.item.update).toHaveBeenCalled();
  });

  it("does NOT touch an update that leaves the photos alone", async () => {
    // An older listing with 1 photo must still be re-priceable. The rule is
    // about REPLACING photos, not about every edit to a listing.
    prismaMock.item.findUnique.mockResolvedValue({
      id: "item-1",
      ownerId: "owner-1",
      images: ["only-one"],
    } as never);
    const next = jest.fn();
    await updateItem(updateReq({ pricePerDay: 50 }), makeRes(), next);
    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.item.update).toHaveBeenCalled();
  });
});
