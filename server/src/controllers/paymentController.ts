import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import axios from 'axios';
import env from '../config/env';

export const createPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { rentalId, type, amount } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    if (rental.renterId !== req.user.userId) {
      throw new ForbiddenError('You can only make payments for your own rentals');
    }

    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        rentalId,
        userId: req.user.userId,
        type,
        amount: parseFloat(amount),
        status: 'PENDING',
        paymentMethod: 'GCash',
      },
    });

    // In production, integrate with GCash API
    // For now, we'll create a mock payment flow
    const paymentData = {
      transactionId: transaction.id,
      amount,
      currency: 'PHP',
      description: `Payment for ${rental.item.title}`,
      redirectUrl: `${env.CLIENT_WEB_URL}/payments/callback`,
    };

    logger.info(`Payment initiated: ${transaction.id} for rental ${rentalId}`);

    res.status(201).json({
      success: true,
      message: 'Payment initiated',
      data: {
        transaction,
        payment: paymentData,
        // In production, return GCash payment URL
        paymentUrl: `${env.GCASH_API_URL}/checkout?tid=${transaction.id}`,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const confirmPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { transactionId, gcashReferenceNo, gcashTransactionId } = req.body;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        rental: {
          include: { item: true },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    // Update transaction
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'COMPLETED',
        gcashReferenceNo,
        gcashTransactionId,
        paidAt: new Date(),
      },
    });

    // Update rental status based on payment type
    if (transaction.type === 'RENTAL_PAYMENT') {
      await prisma.rental.update({
        where: { id: transaction.rentalId },
        data: { status: 'AWAITING_DEPOSIT' },
      });

      // Notify owner to deposit item
      await prisma.notification.create({
        data: {
          userId: transaction.rental.ownerId,
          title: 'Payment Received',
          message: `Payment received for ${transaction.rental.item.title}. Please deposit the item in the kiosk.`,
          type: 'PAYMENT_RECEIVED',
          relatedEntityId: transaction.rentalId,
          relatedEntityType: 'rental',
        },
      });
    }

    logger.info(`Payment confirmed: ${transactionId}`);

    res.json({
      success: true,
      message: 'Payment confirmed successfully',
      data: { transaction: updatedTransaction },
    });
  } catch (error) {
    next(error);
  }
};

export const getTransactions = async (
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

    const where: any = {
      userId: req.user.userId,
    };

    if (status) where.status = status;
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take,
        include: {
          rental: {
            include: {
              item: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        transactions,
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

export const refundPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { transactionId } = req.params;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { rental: true },
    });

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    if (transaction.status !== 'COMPLETED') {
      throw new ValidationError('Only completed transactions can be refunded');
    }

    // Create refund transaction
    const refund = await prisma.transaction.create({
      data: {
        rentalId: transaction.rentalId,
        userId: transaction.userId,
        type: 'DEPOSIT_REFUND',
        amount: transaction.amount,
        status: 'COMPLETED',
        paidAt: new Date(),
        paymentMethod: 'GCash',
      },
    });

    // Update original transaction
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'REFUNDED' },
    });

    // Notify user
    await prisma.notification.create({
      data: {
        userId: transaction.userId,
        title: 'Refund Processed',
        message: `Refund of ₱${transaction.amount} has been processed`,
        type: 'PAYMENT_RECEIVED',
        relatedEntityId: transaction.rentalId,
        relatedEntityType: 'transaction',
      },
    });

    logger.info(`Payment refunded: ${transactionId}`);

    res.json({
      success: true,
      message: 'Refund processed successfully',
      data: { refund },
    });
  } catch (error) {
    next(error);
  }
};
