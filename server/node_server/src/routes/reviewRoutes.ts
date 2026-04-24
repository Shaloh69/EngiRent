import { Router } from "express";
import { body } from "express-validator";
import {
  createReview,
  getItemReviews,
  getUserReviews,
  getMyReviews,
} from "../controllers/reviewController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";

const router = Router();

router.post(
  "/",
  authenticate,
  validate([
    body("rentalId").notEmpty().withMessage("rentalId is required"),
    body("rating").isInt({ min: 1, max: 5 }).withMessage("rating must be 1-5"),
    body("reviewType")
      .isIn(["ITEM", "USER"])
      .withMessage("reviewType must be ITEM or USER"),
  ]),
  createReview,
);

router.get("/me", authenticate, getMyReviews);
router.get("/item/:itemId", getItemReviews);
router.get("/user/:userId", getUserReviews);

export default router;
