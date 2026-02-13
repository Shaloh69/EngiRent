import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  createItem,
  getItems,
  getItemById,
  updateItem,
  deleteItem,
  getMyItems,
} from '../controllers/itemController';
import { authenticate, optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// Create item (protected)
router.post(
  '/',
  authenticate,
  validate([
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('category').isIn([
      'SCHOOL_ATTIRE',
      'ACADEMIC_TOOLS',
      'ELECTRONICS',
      'DEVELOPMENT_KITS',
      'MEASUREMENT_TOOLS',
      'AUDIO_VISUAL',
      'SPORTS_EQUIPMENT',
      'OTHER',
    ]).withMessage('Valid category is required'),
    body('condition').isIn(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'ACCEPTABLE'])
      .withMessage('Valid condition is required'),
    body('pricePerDay').isFloat({ min: 0 }).withMessage('Price per day must be a positive number'),
    body('securityDeposit').isFloat({ min: 0 }).withMessage('Security deposit must be a positive number'),
    body('images').isArray({ min: 1 }).withMessage('At least one image is required'),
  ]),
  createItem
);

// Get all items (public with optional auth)
router.get('/', optionalAuth, getItems);

// Get my items (protected)
router.get('/my-items', authenticate, getMyItems);

// Get item by ID (public with optional auth)
router.get(
  '/:id',
  optionalAuth,
  validate([param('id').isUUID().withMessage('Valid item ID is required')]),
  getItemById
);

// Update item (protected)
router.put(
  '/:id',
  authenticate,
  validate([param('id').isUUID().withMessage('Valid item ID is required')]),
  updateItem
);

// Delete item (protected)
router.delete(
  '/:id',
  authenticate,
  validate([param('id').isUUID().withMessage('Valid item ID is required')]),
  deleteItem
);

export default router;
