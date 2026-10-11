import { Router } from "express";
import { body, param } from "express-validator";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import {
  cancelDisputeVisit,
  getDispute,
  myDisputes,
  myRestriction,
  payDispute,
  requestReview,
} from "../controllers/disputeController";

/** Dispute v2 — the student side (renter and owner). Admin routes live in adminRoutes. */
const router = Router();
router.use(authenticate);

router.get("/restriction", myRestriction);
router.get("/mine", myDisputes);
router.get("/:id", validate([param("id").isUUID()]), getDispute);
router.post("/:id/pay", validate([param("id").isUUID()]), payDispute);
router.post("/:id/cancel-visit", validate([param("id").isUUID()]), cancelDisputeVisit);
router.post(
  "/:id/review-request",
  validate([param("id").isUUID(), body("reason").isString().isLength({ min: 5, max: 2000 })]),
  requestReview,
);

export default router;
