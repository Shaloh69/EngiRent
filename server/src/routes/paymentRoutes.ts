import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  createPayment,
  confirmPayment,
  getTransactions,
  refundPayment,
} from '../controllers/paymentController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// Create payment (protected)
router.post(
  '/',
  authenticate,
  validate([
    body('rentalId').isUUID().withMessage('Valid rental ID is required'),
    body('type').isIn([
      'RENTAL_PAYMENT',
      'SECURITY_DEPOSIT',
      'DEPOSIT_REFUND',
      'LATE_FEE',
      'DAMAGE_FEE',
    ]).withMessage('Valid transaction type is required'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  ]),
  createPayment
);

// Confirm payment (webhook or callback)
router.post(
  '/confirm',
  validate([
    body('transactionId').isUUID().withMessage('Valid transaction ID is required'),
    body('gcashReferenceNo').notEmpty().withMessage('GCash reference number is required'),
  ]),
  confirmPayment
);

// Get transactions (protected)
router.get('/', authenticate, getTransactions);

// Refund payment (protected)
router.post(
  '/:transactionId/refund',
  authenticate,
  validate([param('transactionId').isUUID().withMessage('Valid transaction ID is required')]),
  refundPayment
);

export default router;
