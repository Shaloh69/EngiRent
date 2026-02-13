import { Router } from 'express';
import { param } from 'express-validator';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// Get notifications (protected)
router.get('/', authenticate, getNotifications);

// Mark notification as read (protected)
router.patch(
  '/:id/read',
  authenticate,
  validate([param('id').isUUID().withMessage('Valid notification ID is required')]),
  markAsRead
);

// Mark all as read (protected)
router.patch('/read-all', authenticate, markAllAsRead);

// Delete notification (protected)
router.delete(
  '/:id',
  authenticate,
  validate([param('id').isUUID().withMessage('Valid notification ID is required')]),
  deleteNotification
);

export default router;
