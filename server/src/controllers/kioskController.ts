import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import axios from 'axios';
import env from '../config/env';

export const depositItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { rentalId, lockerId } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    if (rental.ownerId !== req.user.userId) {
      throw new ForbiddenError('Only the owner can deposit the item');
    }

    if (rental.status !== 'AWAITING_DEPOSIT') {
      throw new ValidationError('Rental is not awaiting deposit');
    }

    // Check locker availability
    const locker = await prisma.locker.findUnique({
      where: { id: lockerId },
    });

    if (!locker || locker.status !== 'AVAILABLE') {
      throw new ValidationError('Locker is not available');
    }

    // Update locker status
    await prisma.locker.update({
      where: { id: lockerId },
      data: {
        status: 'OCCUPIED',
        currentRentalId: rentalId,
        lastUsedAt: new Date(),
      },
    });

    // Update rental
    const updatedRental = await prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: 'DEPOSITED',
        depositLockerId: lockerId,
        depositedAt: new Date(),
      },
      include: {
        item: true,
        renter: true,
      },
    });

    // Notify renter
    await prisma.notification.create({
      data: {
        userId: rental.renterId,
        title: 'Item Ready for Claim',
        message: `${rental.item.title} is ready for pickup at locker ${locker.lockerNumber}`,
        type: 'ITEM_READY_FOR_CLAIM',
        relatedEntityId: rentalId,
        relatedEntityType: 'rental',
      },
    });

    logger.info(`Item deposited: rental ${rentalId}, locker ${lockerId}`);

    res.json({
      success: true,
      message: 'Item deposited successfully',
      data: {
        rental: updatedRental,
        locker: {
          id: locker.id,
          lockerNumber: locker.lockerNumber,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const claimItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { rentalId } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: {
        item: true,
        depositLocker: true,
      },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    if (rental.renterId !== req.user.userId) {
      throw new ForbiddenError('Only the renter can claim the item');
    }

    if (rental.status !== 'DEPOSITED') {
      throw new ValidationError('Item is not ready for claim');
    }

    if (!rental.depositLockerId) {
      throw new ValidationError('No locker assigned');
    }

    // Update locker status
    await prisma.locker.update({
      where: { id: rental.depositLockerId },
      data: {
        status: 'AVAILABLE',
        currentRentalId: null,
      },
    });

    // Update rental
    const updatedRental = await prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: 'ACTIVE',
        claimLockerId: rental.depositLockerId,
        claimedAt: new Date(),
      },
      include: {
        item: true,
        owner: true,
      },
    });

    // Notify owner
    await prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: 'Item Claimed',
        message: `Your ${rental.item.title} has been claimed`,
        type: 'RENTAL_STARTED',
        relatedEntityId: rentalId,
        relatedEntityType: 'rental',
      },
    });

    logger.info(`Item claimed: rental ${rentalId}`);

    res.json({
      success: true,
      message: 'Item claimed successfully',
      data: { rental: updatedRental },
    });
  } catch (error) {
    next(error);
  }
};

export const returnItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { rentalId, lockerId, images } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    if (rental.renterId !== req.user.userId) {
      throw new ForbiddenError('Only the renter can return the item');
    }

    if (rental.status !== 'ACTIVE') {
      throw new ValidationError('Rental is not active');
    }

    // Check locker availability
    const locker = await prisma.locker.findUnique({
      where: { id: lockerId },
    });

    if (!locker || locker.status !== 'AVAILABLE') {
      throw new ValidationError('Locker is not available');
    }

    // Update locker status
    await prisma.locker.update({
      where: { id: lockerId },
      data: {
        status: 'OCCUPIED',
        currentRentalId: rentalId,
        lastUsedAt: new Date(),
      },
    });

    // Call ML service for verification
    let verificationResult = null;
    if (images && images.length > 0 && env.ML_SERVICE_URL) {
      try {
        const formData = new FormData();

        // Get original images from item
        const originalImages = rental.item.images as string[];
        originalImages.forEach((img: string) => {
          formData.append('original_images', img);
        });

        // Add return images
        images.forEach((img: string) => {
          formData.append('kiosk_images', img);
        });

        const mlResponse = await axios.post(
          `${env.ML_SERVICE_URL}/api/v1/verify`,
          formData,
          {
            headers: {
              ...(env.ML_SERVICE_API_KEY && {
                'X-API-Key': env.ML_SERVICE_API_KEY,
              }),
            },
          }
        );

        verificationResult = mlResponse.data;
      } catch (error) {
        logger.error('ML verification failed:', error);
      }
    }

    // Create verification record
    const verification = await prisma.verification.create({
      data: {
        originalImages: rental.item.images as any,
        kioskImages: (images || []) as any,
        decision: verificationResult?.decision || 'PENDING',
        confidenceScore: verificationResult?.confidence || 0,
        attemptNumber: 1,
        traditionalScore: verificationResult?.method_scores?.traditional_best,
        siftScore: verificationResult?.method_scores?.sift_best,
        deepLearningScore: verificationResult?.method_scores?.deep_learning_best,
        ocrMatch: verificationResult?.ocr?.match,
        ocrDetails: verificationResult?.ocr?.details as any || {},
        status: verificationResult?.decision === 'APPROVED' ? 'APPROVED' : 'PENDING',
      },
    });

    // Update rental
    const updatedRental = await prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: 'VERIFICATION',
        returnLockerId: lockerId,
        returnedAt: new Date(),
        actualReturnDate: new Date(),
        verificationId: verification.id,
      },
      include: {
        item: true,
        owner: true,
        verification: true,
      },
    });

    // Notify owner
    await prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: 'Item Returned',
        message: `${rental.item.title} has been returned and is under verification`,
        type: 'RETURN_REMINDER',
        relatedEntityId: rentalId,
        relatedEntityType: 'rental',
      },
    });

    logger.info(`Item returned: rental ${rentalId}, verification ${verification.id}`);

    res.json({
      success: true,
      message: 'Item returned successfully. Verification in progress.',
      data: {
        rental: updatedRental,
        verification: {
          id: verification.id,
          decision: verification.decision,
          confidenceScore: verification.confidenceScore,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getAvailableLockers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { kioskId, size } = req.query;

    const where: any = {
      status: 'AVAILABLE',
      isOperational: true,
    };

    if (kioskId) where.kioskId = kioskId;
    if (size) where.size = size;

    const lockers = await prisma.locker.findMany({
      where,
      orderBy: { lockerNumber: 'asc' },
    });

    res.json({
      success: true,
      data: { lockers },
    });
  } catch (error) {
    next(error);
  }
};
