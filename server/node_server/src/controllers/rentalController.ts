import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../utils/errors";
import logger from "../utils/logger";
import {
  findOverlappingRentals,
  recomputeItemAvailability,
} from "../services/itemAvailabilityService";

export const createRental = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const { itemId, startDate, endDate } = req.body;

    // Get item
    const item = await prisma.item.findUnique({
      where: { id: itemId },
    });

    if (!item || !item.isActive) {
      throw new NotFoundError("Item not found");
    }

    if (!item.isListed) {
      throw new ValidationError("This item is not currently listed");
    }

    if (item.ownerId === req.user.userId) {
      throw new ValidationError("You cannot rent your own item");
    }

    // Calculate duration and price
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (days <= 0) {
      throw new ValidationError("Invalid rental period");
    }

    // Checklist Stage 6 — availability is derived from booked date ranges,
    // not a single flag. An item can now be booked by multiple people over
    // time as long as their date ranges don't overlap; only an actual
    // conflict is refused, not "someone else has ever rented this."
    const overlapping = await findOverlappingRentals(itemId, start, end);
    if (overlapping.length > 0) {
      throw new ValidationError(
        "This item is already booked for part of the dates you selected. Pick a different range.",
      );
    }

    const totalPrice = days * item.pricePerDay;

    // Create rental
    const rental = await prisma.rental.create({
      data: {
        itemId,
        renterId: req.user.userId,
        ownerId: item.ownerId,
        startDate: start,
        endDate: end,
        totalPrice,
        securityDeposit: item.securityDeposit,
        status: "PENDING",
      },
      include: {
        item: {
          include: {
            owner: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phoneNumber: true,
                // For the checklist Stage 5 "message the owner" avatar —
                // additive, doesn't change anything that already reads this.
                profileImage: true,
              },
            },
          },
        },
        renter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
          },
        },
      },
    });

    // Checklist Stage 6 — recomputed from real booked ranges rather than
    // unconditionally set false: a rental booked for a future week must not
    // make the item show unavailable *today*, when it's still free to pick
    // up right now for an earlier or immediate booking.
    await recomputeItemAvailability(itemId);

    // Create notification for owner
    await prisma.notification.create({
      data: {
        userId: item.ownerId,
        title: "New Rental Request",
        message: `${req.user.email} wants to rent your ${item.title}`,
        type: "BOOKING_CONFIRMED",
        relatedEntityId: rental.id,
        relatedEntityType: "rental",
      },
    });

    logger.info(`Rental created: ${rental.id} by user ${req.user.userId}`);

    res.status(201).json({
      success: true,
      message: "Rental request created successfully",
      data: { rental },
    });
  } catch (error) {
    next(error);
  }
};

export const getRentals = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const { status, type, page = "1", limit = "10" } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = {};

    // Filter by user type
    if (type === "rented") {
      where.renterId = req.user.userId;
    } else if (type === "owned") {
      where.ownerId = req.user.userId;
    } else {
      where.OR = [{ renterId: req.user.userId }, { ownerId: req.user.userId }];
    }

    if (status) {
      where.status = status;
    }

    const [rentals, total] = await Promise.all([
      prisma.rental.findMany({
        where,
        skip,
        take,
        include: {
          item: true,
          renter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
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
      prisma.rental.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        rentals,
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

export const getRentalById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const id = req.params.id as string;

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: {
        item: {
          include: {
            owner: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phoneNumber: true,
                // For the checklist Stage 5 "message the owner" avatar —
                // additive, doesn't change anything that already reads this.
                profileImage: true,
              },
            },
          },
        },
        renter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
          },
        },
        transactions: true,
        verification: true,
      },
    });

    if (!rental) {
      throw new NotFoundError("Rental not found");
    }

    // Check if user is involved in this rental
    if (
      rental.renterId !== req.user.userId &&
      rental.ownerId !== req.user.userId
    ) {
      throw new ForbiddenError("Access denied");
    }

    res.json({
      success: true,
      data: { rental },
    });
  } catch (error) {
    next(error);
  }
};

// Manual (client-initiated) status transitions that are safe to allow.
// The real lifecycle states — DEPOSITED, ACTIVE, VERIFICATION, COMPLETED,
// DISPUTED — are *earned* through kiosk verification, payment webhooks, or
// admin review and must never be settable directly by a participant, or the
// verification/payment gates could be skipped. Admins use the dedicated
// /admin routes (force-complete, settle) for privileged transitions.
const ALLOWED_MANUAL_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CANCELLED"],
  AWAITING_DEPOSIT: ["CANCELLED"],
};

export const updateRentalStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const id = req.params.id as string;
    const { status } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError("Rental not found");
    }

    // Validate user permissions
    if (
      rental.renterId !== req.user.userId &&
      rental.ownerId !== req.user.userId
    ) {
      throw new ForbiddenError("Access denied");
    }

    // Enforce the transition whitelist — reject any attempt to jump into a
    // verification/payment-earned state.
    const allowedNext = ALLOWED_MANUAL_TRANSITIONS[rental.status] ?? [];
    if (!allowedNext.includes(status)) {
      throw new ValidationError(
        `Transition ${rental.status} → ${status} is not permitted here. ` +
          `This status is set automatically by the kiosk/payment flow.`,
      );
    }

    const updatedRental = await prisma.rental.update({
      where: { id },
      data: { status },
      include: {
        item: true,
        renter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // The only permitted transition here is → CANCELLED. Free the item and
    // notify the other party, mirroring cancelRental.
    if (status === "CANCELLED") {
      // Recomputed, not forced true: a back-to-back booking for today on
      // this same item (now possible under Stage 6) must not be shown
      // available just because a different, non-overlapping rental cancelled.
      await recomputeItemAvailability(rental.itemId);
      const notifyUserId =
        rental.renterId === req.user.userId ? rental.ownerId : rental.renterId;
      await prisma.notification.create({
        data: {
          userId: notifyUserId,
          title: "Rental Cancelled",
          message: `Rental for ${rental.item.title} has been cancelled`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: rental.id,
          relatedEntityType: "rental",
        },
      });
    }

    logger.info(`Rental ${id} status updated to ${status}`);

    res.json({
      success: true,
      message: "Rental status updated successfully",
      data: { rental: updatedRental },
    });
  } catch (error) {
    next(error);
  }
};

export const cancelRental = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const id = req.params.id as string;

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError("Rental not found");
    }

    if (
      rental.renterId !== req.user.userId &&
      rental.ownerId !== req.user.userId
    ) {
      throw new ForbiddenError("Access denied");
    }

    if (!["PENDING", "AWAITING_DEPOSIT"].includes(rental.status)) {
      throw new ValidationError("Rental cannot be cancelled at this stage");
    }

    await prisma.rental.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    // Recomputed, not forced true — see the identical comment above.
    await recomputeItemAvailability(rental.itemId);

    // Notify other party
    const notifyUserId =
      rental.renterId === req.user.userId ? rental.ownerId : rental.renterId;

    await prisma.notification.create({
      data: {
        userId: notifyUserId,
        title: "Rental Cancelled",
        message: `Rental for ${rental.item.title} has been cancelled`,
        type: "SYSTEM_ANNOUNCEMENT",
        relatedEntityId: rental.id,
        relatedEntityType: "rental",
      },
    });

    logger.info(`Rental cancelled: ${id} by user ${req.user.userId}`);

    res.json({
      success: true,
      message: "Rental cancelled successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /rentals/:id/dates — checklist Stage 9. "Extend/shorten a rental —
 * better than the late-fee path, currently the only option." Only the
 * renter can request it, only while the rental is genuinely in flight
 * (AWAITING_DEPOSIT/DEPOSITED/ACTIVE — not PENDING, where nothing is
 * committed yet, and not a terminal status). Reuses the exact same overlap
 * check createRental uses (excluding this rental itself), so a new end
 * date can never silently create the double-booking Stage 6 exists to
 * prevent.
 *
 * Money: if the new range is longer, the price difference is billed as an
 * EXTENSION_FEE — deducted from the held deposit at settlement, the same
 * mechanism as a LATE_FEE, not a second immediate PayMongo charge. A
 * shorter range reduces totalPrice with no refund of money not yet
 * collected (the original RENTAL_PAYMENT, if already made, is untouched).
 */
export const extendRental = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const id = req.params.id as string;
    const { endDate } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { item: true },
    });
    if (!rental) throw new NotFoundError("Rental not found");
    if (rental.renterId !== req.user.userId) {
      throw new ForbiddenError("Only the renter can change a rental's dates");
    }
    if (!["AWAITING_DEPOSIT", "DEPOSITED", "ACTIVE"].includes(rental.status)) {
      throw new ValidationError(
        "Dates can only be changed while the rental is awaiting deposit, deposited, or active",
      );
    }

    const newEnd = new Date(endDate);
    if (Number.isNaN(newEnd.getTime()) || newEnd <= rental.startDate) {
      throw new ValidationError("The new end date must be after the start date");
    }
    if (newEnd.getTime() === rental.endDate.getTime()) {
      throw new ValidationError("That is already the current end date");
    }

    const overlapping = await findOverlappingRentals(
      rental.itemId,
      rental.startDate,
      newEnd,
      id,
    );
    if (overlapping.length > 0) {
      throw new ValidationError(
        "This item is booked by someone else for part of the new range. Pick an earlier date.",
      );
    }

    const newDays = Math.ceil(
      (newEnd.getTime() - rental.startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const newTotalPrice = newDays * rental.item.pricePerDay;
    const priceDelta = newTotalPrice - rental.totalPrice;
    const extending = newEnd > rental.endDate;

    await prisma.$transaction(async (tx) => {
      await tx.rental.update({
        where: { id },
        data: { endDate: newEnd, totalPrice: newTotalPrice },
      });
      if (extending && priceDelta > 0) {
        await tx.transaction.create({
          data: {
            rentalId: id,
            userId: rental.renterId,
            type: "EXTENSION_FEE",
            amount: priceDelta,
            status: "COMPLETED",
            paidAt: new Date(),
            paymentMethod: "Held Deposit Deduction",
          },
        });
      }
      await tx.notification.create({
        data: {
          userId: rental.ownerId,
          title: extending ? "Rental extended" : "Rental shortened",
          message: `${req.user!.email} ${extending ? "extended" : "shortened"} the rental for ${rental.item.title} — new return date ${newEnd.toLocaleDateString()}.`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: id,
          relatedEntityType: "rental",
        },
      });
    });

    await recomputeItemAvailability(rental.itemId);

    logger.info(
      `Rental ${id} dates changed by ${req.user.userId}: endDate ${rental.endDate.toISOString()} → ${newEnd.toISOString()} (₱${priceDelta >= 0 ? "+" : ""}${priceDelta})`,
    );

    res.json({
      success: true,
      message: extending ? "Rental extended" : "Rental shortened",
      data: {
        endDate: newEnd,
        totalPrice: newTotalPrice,
        extensionFeeCharged: extending && priceDelta > 0 ? priceDelta : 0,
      },
    });
  } catch (error) {
    next(error);
  }
};
