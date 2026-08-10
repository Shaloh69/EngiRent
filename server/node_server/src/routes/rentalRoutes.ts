import { Router } from "express";
import { body, param } from "express-validator";
import {
  createRental,
  getRentals,
  getRentalById,
  updateRentalStatus,
  cancelRental,
  extendRental,
} from "../controllers/rentalController";
import { getConversation, sendMessage } from "../controllers/messageController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";

const router = Router();

// Create rental (protected)
router.post(
  "/",
  authenticate,
  validate([
    body("itemId").isUUID().withMessage("Valid item ID is required"),
    body("startDate").isISO8601().withMessage("Valid start date is required"),
    body("endDate").isISO8601().withMessage("Valid end date is required"),
  ]),
  createRental,
);

// Get rentals (protected)
router.get("/", authenticate, getRentals);

// Get rental by ID (protected)
router.get(
  "/:id",
  authenticate,
  validate([param("id").isUUID().withMessage("Valid rental ID is required")]),
  getRentalById,
);

// Update rental status (protected)
router.patch(
  "/:id/status",
  authenticate,
  validate([
    param("id").isUUID().withMessage("Valid rental ID is required"),
    body("status")
      .isIn([
        "PENDING",
        "AWAITING_DEPOSIT",
        "DEPOSITED",
        "ACTIVE",
        "VERIFICATION",
        "COMPLETED",
        "CANCELLED",
        "DISPUTED",
      ])
      .withMessage("Valid status is required"),
  ]),
  updateRentalStatus,
);

// Cancel rental (protected)
router.post(
  "/:id/cancel",
  authenticate,
  validate([param("id").isUUID().withMessage("Valid rental ID is required")]),
  cancelRental,
);

// Extend/shorten a rental (checklist Stage 9)
router.patch(
  "/:id/dates",
  authenticate,
  validate([
    param("id").isUUID().withMessage("Valid rental ID is required"),
    body("endDate").isISO8601().withMessage("Valid end date is required"),
  ]),
  extendRental,
);

// ── In-app messaging (checklist Stage 5) ────────────────────────────────────
router.get(
  "/:id/conversation",
  authenticate,
  validate([param("id").isUUID().withMessage("Valid rental ID is required")]),
  getConversation,
);

router.post(
  "/:id/conversation/messages",
  authenticate,
  validate([
    param("id").isUUID().withMessage("Valid rental ID is required"),
    body("body").notEmpty().withMessage("Message body is required"),
  ]),
  sendMessage,
);

export default router;
