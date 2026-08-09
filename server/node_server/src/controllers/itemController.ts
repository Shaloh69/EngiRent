import { Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../utils/errors";
import logger from "../utils/logger";
import axios from "axios";
import env from "../config/env";

/**
 * Pre-extract and cache ML verification features for an item's listing
 * photos, in the background (doesn't block the HTTP response). Shared by
 * createItem (initial listing) and updateItem (whenever `images` changes) —
 * the cache must be refreshed on both, not just populated once at creation.
 */
function extractAndCacheMlFeatures(itemId: string, images: string[]): void {
  if (!env.ML_SERVICE_URL || images.length === 0) return;
  setImmediate(async () => {
    try {
      const formData = new FormData();
      for (const url of images) {
        const resp = await axios.get(url, { responseType: "arraybuffer" });
        const blob = new Blob([resp.data as ArrayBuffer], {
          type: "image/jpeg",
        });
        formData.append("images", blob, "image.jpg");
      }
      const mlResp = await axios.post(
        `${env.ML_SERVICE_URL}/api/v1/extract-features`,
        formData,
        {
          headers: {
            ...(env.ML_SERVICE_API_KEY && {
              "X-API-Key": env.ML_SERVICE_API_KEY,
            }),
          },
        },
      );
      await prisma.item.update({
        where: { id: itemId },
        data: { mlFeatures: mlResp.data.features as any },
      });
      logger.info(`ML features cached for item ${itemId}`);
    } catch (err) {
      logger.warn(`Failed to pre-extract ML features for item ${itemId}:`, err);
    }
  });
}

export const createItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const {
      title,
      description,
      category,
      condition,
      pricePerDay,
      pricePerWeek,
      pricePerMonth,
      securityDeposit,
      images,
      serialNumber,
      campusLocation,
    } = req.body;

    const item = await prisma.item.create({
      data: {
        ownerId: req.user.userId,
        title,
        description,
        category,
        condition,
        pricePerDay: parseFloat(pricePerDay),
        pricePerWeek: pricePerWeek ? parseFloat(pricePerWeek) : null,
        pricePerMonth: pricePerMonth ? parseFloat(pricePerMonth) : null,
        securityDeposit: parseFloat(securityDeposit),
        images,
        serialNumber,
        campusLocation,
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    logger.info(`Item created: ${item.id} by user ${req.user.userId}`);

    // Pre-extract ML features in the background so verification is faster —
    // doesn't block this response; failure only logs a warning.
    if (images && (images as string[]).length > 0) {
      extractAndCacheMlFeatures(item.id, images as string[]);
    }

    res.status(201).json({
      success: true,
      message: "Item created successfully",
      data: { item },
    });
  } catch (error) {
    next(error);
  }
};

export const getItems = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      category,
      search,
      minPrice,
      maxPrice,
      condition,
      isAvailable,
      campusLocation,
      page = "1",
      limit = "10",
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = {
      isActive: true,
      // Owner-unlisted items disappear from browse. Without this the unlist
      // control would be decorative — the item would stay bookable by anyone
      // who found it.
      isListed: true,
    };

    if (category) where.category = category;
    if (condition) where.condition = condition;
    if (campusLocation) where.campusLocation = campusLocation;
    if (isAvailable !== undefined) where.isAvailable = isAvailable === "true";

    if (search) {
      where.OR = [
        { title: { contains: search as string } },
        { description: { contains: search as string } },
      ];
    }

    if (minPrice || maxPrice) {
      where.pricePerDay = {};
      if (minPrice) where.pricePerDay.gte = parseFloat(minPrice as string);
      if (maxPrice) where.pricePerDay.lte = parseFloat(maxPrice as string);
    }

    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        skip,
        take,
        include: {
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.item.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getItemById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.params.id as string;

    const item = await prisma.item.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
            email: true,
            phoneNumber: true,
          },
        },
        reviews: {
          include: {
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profileImage: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!item) {
      throw new NotFoundError("Item not found");
    }

    res.json({
      success: true,
      data: { item },
    });
  } catch (error) {
    next(error);
  }
};

export const updateItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const id = req.params.id as string;

    const item = await prisma.item.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundError("Item not found");
    }

    if (item.ownerId !== req.user.userId) {
      throw new ForbiddenError("You can only update your own items");
    }

    const {
      title,
      description,
      category,
      condition,
      pricePerDay,
      pricePerWeek,
      pricePerMonth,
      securityDeposit,
      images,
      serialNumber,
      campusLocation,
      isAvailable,
      isListed,
    } = req.body;

    // isAvailable belongs to the rental lifecycle, not the owner. Letting an
    // owner set it true while a rental is in flight would put the item back
    // into browse mid-rental and allow a double booking. Unlisting is what an
    // owner actually wants here, and that is isListed.
    if (isAvailable !== undefined) {
      const inFlight = await prisma.rental.count({
        where: {
          itemId: id,
          status: {
            in: [
              "PENDING",
              "AWAITING_DEPOSIT",
              "DEPOSITED",
              "ACTIVE",
              "VERIFICATION",
            ],
          },
        },
      });
      if (inFlight > 0) {
        throw new ValidationError(
          "This item has a rental in progress. Unlist it instead — it will stop appearing in browse without affecting the current rental.",
        );
      }
    }

    // If listing photos change, the cached ML feature vectors (extracted
    // from the *old* photos) must not survive — a stale cache silently
    // compared against new photos would produce wrong verification results
    // at the kiosk. Null it out synchronously in the same update, then
    // re-trigger background extraction against the new photos below.
    const imagesChanged = images !== undefined;

    const updatedItem = await prisma.item.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(category && { category }),
        ...(condition && { condition }),
        ...(pricePerDay && { pricePerDay: parseFloat(pricePerDay) }),
        ...(pricePerWeek !== undefined && {
          pricePerWeek: pricePerWeek ? parseFloat(pricePerWeek) : null,
        }),
        ...(pricePerMonth !== undefined && {
          pricePerMonth: pricePerMonth ? parseFloat(pricePerMonth) : null,
        }),
        ...(securityDeposit && {
          securityDeposit: parseFloat(securityDeposit),
        }),
        ...(images && { images }),
        ...(imagesChanged && { mlFeatures: Prisma.JsonNull }),
        ...(serialNumber !== undefined && { serialNumber }),
        ...(campusLocation && { campusLocation }),
        ...(isAvailable !== undefined && { isAvailable }),
        ...(isListed !== undefined && { isListed }),
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    if (imagesChanged && (images as string[]).length > 0) {
      extractAndCacheMlFeatures(id, images as string[]);
    }

    logger.info(`Item updated: ${id} by user ${req.user.userId}`);

    res.json({
      success: true,
      message: "Item updated successfully",
      data: { item: updatedItem },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const id = req.params.id as string;

    const item = await prisma.item.findUnique({
      where: { id },
      include: {
        rentals: {
          where: {
            status: {
              in: ["PENDING", "AWAITING_DEPOSIT", "DEPOSITED", "ACTIVE"],
            },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundError("Item not found");
    }

    if (item.ownerId !== req.user.userId) {
      throw new ForbiddenError("You can only delete your own items");
    }

    if (item.rentals.length > 0) {
      throw new ValidationError("Cannot delete item with active rentals");
    }

    await prisma.item.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info(`Item deleted (soft): ${id} by user ${req.user.userId}`);

    res.json({
      success: true,
      message: "Item deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const getMyItems = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const { page = "1", limit = "10" } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Statuses that mean "someone currently has, or is committed to, this
    // item" — the same set deleteItem refuses to delete against, kept
    // identical on purpose so the screen never offers a delete the API will
    // reject.
    const IN_FLIGHT = [
      "PENDING",
      "AWAITING_DEPOSIT",
      "DEPOSITED",
      "ACTIVE",
      "VERIFICATION",
    ] as const;

    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where: {
          ownerId: req.user.userId,
          isActive: true,
        },
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          // ItemModel.fromJson (the Flutter model shared with the public
          // browse screen) requires `owner` and throws without it. The
          // original query never included it — harmless while nothing called
          // this endpoint, a crash the moment it was wired up.
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
          // The owner screen has to distinguish "available", "rented out" and
          // "unlisted", and a bare item row cannot: isAvailable alone doesn't
          // say who has it or until when.
          rentals: {
            where: { status: { in: [...IN_FLIGHT] } },
            orderBy: { startDate: "asc" },
            take: 1,
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              renter: { select: { firstName: true, lastName: true } },
            },
          },
          _count: { select: { reviews: true, rentals: true } },
        },
      }),
      prisma.item.count({
        where: {
          ownerId: req.user.userId,
          isActive: true,
        },
      }),
    ]);

    const withState = items.map((item) => {
      const { rentals, _count, ...rest } = item;
      const active = rentals[0] ?? null;
      return {
        ...rest,
        reviewCount: _count.reviews,
        rentalCount: _count.rentals,
        activeRental: active,
        // Resolved server-side so the app and the console can't disagree
        // about what a combination of three booleans means. An active rental
        // takes priority over the owner's isListed choice: unlisting an item
        // that's currently out doesn't make the fact that someone has it any
        // less true, and hiding that behind "Unlisted" would be the more
        // consequential thing to lose sight of. `item.isListed` is still in
        // the response (spread via `...rest`) so the app can show "also
        // hidden from browse" alongside "Rented" when both are true.
        listingState: active
          ? "RENTED"
          : !item.isListed
            ? "UNLISTED"
            : item.isAvailable
              ? "AVAILABLE"
              : "UNAVAILABLE",
        // Deleting is refused while a rental is in flight; saying so up front
        // beats letting the app offer the action and surface a 400 toast.
        canDelete: !active,
      };
    });

    res.json({
      success: true,
      data: {
        items: withState,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
