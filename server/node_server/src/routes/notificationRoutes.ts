import { Router } from "express";
import { param } from "express-validator";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../controllers/notificationController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";

const router = Router();

// Get notifications (protected)
router.get("/", authenticate, getNotifications);

// Notification preferences (checklist Stage 9) — before "/:id" routes so
// "preferences" never gets swallowed by an :id param.
router.get("/preferences", authenticate, getNotificationPreferences);
router.put("/preferences", authenticate, updateNotificationPreferences);

// Mark notification as read (protected)
router.patch(
  "/:id/read",
  authenticate,
  validate([
    param("id").isUUID().withMessage("Valid notification ID is required"),
  ]),
  markAsRead,
);

// Mark all as read (protected)
router.patch("/read-all", authenticate, markAllAsRead);

// Delete notification (protected)
router.delete(
  "/:id",
  authenticate,
  validate([
    param("id").isUUID().withMessage("Valid notification ID is required"),
  ]),
  deleteNotification,
);

export default router;
