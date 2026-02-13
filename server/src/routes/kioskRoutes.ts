import { Router } from 'express';
import { body } from 'express-validator';
import {
  depositItem,
  claimItem,
  returnItem,
  getAvailableLockers,
} from '../controllers/kioskController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// Deposit item (protected)
router.post(
  '/deposit',
  authenticate,
  validate([
    body('rentalId').isUUID().withMessage('Valid rental ID is required'),
    body('lockerId').isUUID().withMessage('Valid locker ID is required'),
  ]),
  depositItem
);

// Claim item (protected)
router.post(
  '/claim',
  authenticate,
  validate([
    body('rentalId').isUUID().withMessage('Valid rental ID is required'),
  ]),
  claimItem
);

// Return item (protected)
router.post(
  '/return',
  authenticate,
  validate([
    body('rentalId').isUUID().withMessage('Valid rental ID is required'),
    body('lockerId').isUUID().withMessage('Valid locker ID is required'),
    body('images').isArray().withMessage('Images array is required'),
  ]),
  returnItem
);

// Get available lockers (protected)
router.get('/lockers', authenticate, getAvailableLockers);

export default router;
