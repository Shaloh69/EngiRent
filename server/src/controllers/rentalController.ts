import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';

export const createRental = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { itemId, startDate, endDate } = req.body;

    // Get item
    const item = await prisma.item.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    if (!item.isAvailable) {
      throw new ValidationError('Item is not available for rent');
    }

    if (item.ownerId === req.user.userId) {
      throw new ValidationError('You cannot rent your own item');
    }

    // Calculate duration and price
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (days <= 0) {
      throw new ValidationError('Invalid rental period');
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
        status: 'PENDING',
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
          },
        },
      },
    });

    // Update item availability
    await prisma.item.update({
      where: { id: itemId },
      data: { isAvailable: false },
    });

    // Create notification for owner
    await prisma.notification.create({
      data: {
        userId: item.ownerId,
        title: 'New Rental Request',
        message: `${req.user.email} wants to rent your ${item.title}`,
        type: 'BOOKING_CONFIRMED',
        relatedEntityId: rental.id,
        relatedEntityType: 'rental',
      },
    });

    logger.info(`Rental created: ${rental.id} by user ${req.user.userId}`);

    res.status(201).json({
      success: true,
      message: 'Rental request created successfully',
      data: { rental },
    });
  } catch (error) {
    next(error);
  }
};

export const getRentals = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { status, type, page = '1', limit = '10' } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = {};

    // Filter by user type
    if (type === 'rented') {
      where.renterId = req.user.userId;
    } else if (type === 'owned') {
      where.ownerId = req.user.userId;
    } else {
      where.OR = [
        { renterId: req.user.userId },
        { ownerId: req.user.userId },
      ];
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
        orderBy: { createdAt: 'desc' },
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
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
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
          },
        },
        transactions: true,
        verification: true,
      },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    // Check if user is involved in this rental
    if (rental.renterId !== req.user.userId && rental.ownerId !== req.user.userId) {
      throw new ForbiddenError('Access denied');
    }

    res.json({
      success: true,
      data: { rental },
    });
  } catch (error) {
    next(error);
  }
};

export const updateRentalStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const id = req.params.id as string;
    const { status, lockerId } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    // Validate user permissions
    if (rental.renterId !== req.user.userId && rental.ownerId !== req.user.userId) {
      throw new ForbiddenError('Access denied');
    }

    // Update rental
    const updateData: any = { status };

    if (status === 'DEPOSITED' && lockerId) {
      updateData.depositLockerId = lockerId;
      updateData.depositedAt = new Date();
    } else if (status === 'ACTIVE' && lockerId) {
      updateData.claimLockerId = lockerId;
      updateData.claimedAt = new Date();
    } else if (status === 'AWAITING_RETURN') {
      updateData.returnedAt = new Date();
    }

    const updatedRental = await prisma.rental.update({
      where: { id },
      data: updateData,
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

    // Create notification based on status
    let notificationData: any = null;
    if (status === 'DEPOSITED') {
      notificationData = {
        userId: rental.renterId,
        title: 'Item Deposited',
        message: `${rental.item.title} has been deposited in the kiosk`,
        type: 'ITEM_READY_FOR_CLAIM',
        relatedEntityId: rental.id,
        relatedEntityType: 'rental',
      };
    } else if (status === 'ACTIVE') {
      notificationData = {
        userId: rental.ownerId,
        title: 'Item Claimed',
        message: `Your ${rental.item.title} has been claimed`,
        type: 'RENTAL_STARTED',
        relatedEntityId: rental.id,
        relatedEntityType: 'rental',
      };
    }

    if (notificationData) {
      await prisma.notification.create({ data: notificationData });
    }

    logger.info(`Rental ${id} status updated to ${status}`);

    res.json({
      success: true,
      message: 'Rental status updated successfully',
      data: { rental: updatedRental },
    });
  } catch (error) {
    next(error);
  }
};

export const cancelRental = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const id = req.params.id as string;

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    if (rental.renterId !== req.user.userId && rental.ownerId !== req.user.userId) {
      throw new ForbiddenError('Access denied');
    }

    if (!['PENDING', 'AWAITING_DEPOSIT'].includes(rental.status)) {
      throw new ValidationError('Rental cannot be cancelled at this stage');
    }

    await prisma.rental.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    // Make item available again
    await prisma.item.update({
      where: { id: rental.itemId },
      data: { isAvailable: true },
    });

    // Notify other party
    const notifyUserId = rental.renterId === req.user.userId
      ? rental.ownerId
      : rental.renterId;

    await prisma.notification.create({
      data: {
        userId: notifyUserId,
        title: 'Rental Cancelled',
        message: `Rental for ${rental.item.title} has been cancelled`,
        type: 'SYSTEM_ANNOUNCEMENT',
        relatedEntityId: rental.id,
        relatedEntityType: 'rental',
      },
    });

    logger.info(`Rental cancelled: ${id} by user ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Rental cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
};
