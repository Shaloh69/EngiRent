import { Router } from "express";
import { body, param } from "express-validator";
import {
  createItem,
  getItems,
  getItemById,
  updateItem,
  deleteItem,
  getMyItems,
  getBookedDates,
} from "../controllers/itemController";
import { authenticate, optionalAuth, requireVerified } from "../middleware/auth";
import { blockIfRestricted } from "../middleware/restriction";
import { validate } from "../middleware/validation";
import { MIN_ITEM_PHOTOS } from "../utils/itemPhotoRules";

const router = Router();

// Create item (protected)
router.post(
  "/",
  authenticate,
  requireVerified,
  blockIfRestricted,
  validate([
    body("title").notEmpty().withMessage("Title is required"),
    body("description").notEmpty().withMessage("Description is required"),
    body("category")
      .isIn([
        "SCHOOL_ATTIRE",
        "ACADEMIC_TOOLS",
        "ELECTRONICS",
        "DEVELOPMENT_KITS",
        "MEASUREMENT_TOOLS",
        "AUDIO_VISUAL",
        "SPORTS_EQUIPMENT",
        "OTHER",
      ])
      .withMessage("Valid category is required"),
    body("condition")
      .isIn(["NEW", "LIKE_NEW", "GOOD", "FAIR", "ACCEPTABLE"])
      .withMessage("Valid condition is required"),
    body("pricePerDay")
      .isFloat({ min: 0 })
      .withMessage("Price per day must be a positive number"),
    body("securityDeposit")
      .isFloat({ min: 0 })
      .withMessage("Security deposit must be a positive number"),
    // D-89: was min 1. See utils/itemPhotoRules for why it is 3.
    body("images")
      .isArray({ min: MIN_ITEM_PHOTOS })
      .withMessage(
        `At least ${MIN_ITEM_PHOTOS} photos from different angles are required`,
      ),
    body("video")
      .optional({ values: "falsy" })
      .isURL()
      .withMessage("Video must be a valid URL"),
  ]),
  createItem,
);

// Get all items (public with optional auth)
router.get("/", optionalAuth, getItems);

// Get my items (protected)
router.get("/my-items", authenticate, getMyItems);

// Checklist Stage 6 — booked date ranges, for the checkout calendar to grey
// out. Public, matching browse's own visibility.
router.get(
  "/:id/booked-dates",
  optionalAuth,
  validate([param("id").isUUID().withMessage("Valid item ID is required")]),
  getBookedDates,
);

// Get item by ID (public with optional auth)
router.get(
  "/:id",
  optionalAuth,
  validate([param("id").isUUID().withMessage("Valid item ID is required")]),
  getItemById,
);

// Update item (protected)
router.put(
  "/:id",
  authenticate,
  requireVerified,
  blockIfRestricted,
  validate([param("id").isUUID().withMessage("Valid item ID is required")]),
  updateItem,
);

// Delete item (protected)
router.delete(
  "/:id",
  authenticate,
  validate([param("id").isUUID().withMessage("Valid item ID is required")]),
  deleteItem,
);

export default router;
