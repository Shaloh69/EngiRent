import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
} from "../utils/errors";
import logger from "../utils/logger";

export const createReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const { rentalId, rating, comment, reviewType } = req.body;

    if (!rentalId || !rating || !reviewType) {
      throw new ValidationError(
        "rentalId, rating, and reviewType are required",
      );
    }
    if (!["ITEM", "USER"].includes(reviewType)) {
      throw new ValidationError("reviewType must be ITEM or USER");
    }
    if (rating < 1 || rating > 5) {
      throw new ValidationError("rating must be between 1 and 5");
    }

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId as string },
      include: { item: true },
    });

    if (!rental) throw new NotFoundError("Rental not found");
    if (rental.status !== "COMPLETED") {
      throw new ValidationError(
        "Reviews can only be submitted for completed rentals",
      );
    }

    const isRenter = rental.renterId === req.user.userId;
    const isOwner = rental.ownerId === req.user.userId;

    if (!isRenter && !isOwner) {
      throw new UnauthorizedError("You are not a participant in this rental");
    }

    const recipientId = isRenter ? rental.ownerId : rental.renterId;

    const existing = await prisma.review.findUnique({
      where: {
        rentalId_authorId_reviewType: {
          rentalId,
          authorId: req.user.userId,
          reviewType,
        },
      },
    });
    if (existing)
      throw new ConflictError("You have already submitted this review");

    const review = await prisma.review.create({
      data: {
        itemId: rental.itemId,
        rentalId,
        authorId: req.user.userId,
        recipientId,
        rating: Number(rating),
        comment: comment ?? null,
        reviewType,
      },
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
    });

    // Update item average rating
    if (reviewType === "ITEM") {
      const agg = await prisma.review.aggregate({
        where: { itemId: rental.itemId, reviewType: "ITEM" },
        _avg: { rating: true },
        _count: { rating: true },
      });
      await prisma.item.update({
        where: { id: rental.itemId },
        data: { averageRating: agg._avg.rating ?? 0 },
      });
    }

    logger.info(`Review created by ${req.user.email} for rental ${rentalId}`);
    res.status(201).json({ success: true, data: { review } });
  } catch (error) {
    next(error);
  }
};

export const getItemReviews = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { itemId } = req.params;
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt((req.query.limit as string) ?? "10", 10)),
    );

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { itemId: itemId as string, reviewType: "ITEM" },
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
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.review.count({
        where: { itemId: itemId as string, reviewType: "ITEM" },
      }),
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getUserReviews = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { userId } = req.params;
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt((req.query.limit as string) ?? "10", 10)),
    );

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { recipientId: userId as string, reviewType: "USER" },
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
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.review.count({
        where: { recipientId: userId as string, reviewType: "USER" },
      }),
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getMyReviews = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const reviews = await prisma.review.findMany({
      where: { authorId: req.user.userId },
      include: {
        item: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: { reviews } });
  } catch (error) {
    next(error);
  }
};
