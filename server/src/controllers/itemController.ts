import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';

export const createItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
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

    res.status(201).json({
      success: true,
      message: 'Item created successfully',
      data: { item },
    });
  } catch (error) {
    next(error);
  }
};

export const getItems = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
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
      page = '1',
      limit = '10',
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = {
      isActive: true,
    };

    if (category) where.category = category;
    if (condition) where.condition = condition;
    if (campusLocation) where.campusLocation = campusLocation;
    if (isAvailable !== undefined) where.isAvailable = isAvailable === 'true';

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
        orderBy: { createdAt: 'desc' },
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
  next: NextFunction
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
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!item) {
      throw new NotFoundError('Item not found');
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
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const id = req.params.id as string;

    const item = await prisma.item.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    if (item.ownerId !== req.user.userId) {
      throw new ForbiddenError('You can only update your own items');
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
    } = req.body;

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
        ...(securityDeposit && { securityDeposit: parseFloat(securityDeposit) }),
        ...(images && { images }),
        ...(serialNumber !== undefined && { serialNumber }),
        ...(campusLocation && { campusLocation }),
        ...(isAvailable !== undefined && { isAvailable }),
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

    logger.info(`Item updated: ${id} by user ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Item updated successfully',
      data: { item: updatedItem },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const id = req.params.id as string;

    const item = await prisma.item.findUnique({
      where: { id },
      include: {
        rentals: {
          where: {
            status: {
              in: ['PENDING', 'AWAITING_DEPOSIT', 'DEPOSITED', 'AWAITING_CLAIM', 'ACTIVE'],
            },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    if (item.ownerId !== req.user.userId) {
      throw new ForbiddenError('You can only delete your own items');
    }

    if (item.rentals.length > 0) {
      throw new ValidationError('Cannot delete item with active rentals');
    }

    await prisma.item.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info(`Item deleted (soft): ${id} by user ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Item deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getMyItems = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { page = '1', limit = '10' } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where: {
          ownerId: req.user.userId,
          isActive: true,
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.item.count({
        where: {
          ownerId: req.user.userId,
          isActive: true,
        },
      }),
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
