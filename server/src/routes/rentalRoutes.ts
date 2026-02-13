import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  createRental,
  getRentals,
  getRentalById,
  updateRentalStatus,
  cancelRental,
} from '../controllers/rentalController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// Create rental (protected)
router.post(
  '/',
  authenticate,
  validate([
    body('itemId').isUUID().withMessage('Valid item ID is required'),
    body('startDate').isISO8601().withMessage('Valid start date is required'),
    body('endDate').isISO8601().withMessage('Valid end date is required'),
  ]),
  createRental
);

// Get rentals (protected)
router.get('/', authenticate, getRentals);

// Get rental by ID (protected)
router.get(
  '/:id',
  authenticate,
  validate([param('id').isUUID().withMessage('Valid rental ID is required')]),
  getRentalById
);

// Update rental status (protected)
router.patch(
  '/:id/status',
  authenticate,
  validate([
    param('id').isUUID().withMessage('Valid rental ID is required'),
    body('status').isIn([
      'PENDING',
      'AWAITING_DEPOSIT',
      'DEPOSITED',
      'AWAITING_CLAIM',
      'ACTIVE',
      'AWAITING_RETURN',
      'VERIFICATION',
      'COMPLETED',
      'CANCELLED',
      'DISPUTED',
    ]).withMessage('Valid status is required'),
  ]),
  updateRentalStatus
);

// Cancel rental (protected)
router.post(
  '/:id/cancel',
  authenticate,
  validate([param('id').isUUID().withMessage('Valid rental ID is required')]),
  cancelRental
);

export default router;
