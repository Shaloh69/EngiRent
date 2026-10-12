import { Router } from "express";
import { body, param } from "express-validator";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import { uploadEvidence } from "../middleware/upload";
import { getConcern, getReportOptions, postConcern, postPayment, postResponse } from "../controllers/concernController";

/** Concerns v2 — the student side (renter and owner). Admin routes live in adminRoutes. */
const router = Router();
router.use(authenticate);

router.get("/options/:rentalId", validate([param("rentalId").isUUID()]), getReportOptions);
router.post("/", uploadEvidence, postConcern);
router.get("/:id", validate([param("id").isUUID()]), getConcern);
router.post("/:id/respond", validate([param("id").isUUID()]), uploadEvidence, postResponse);
router.post(
  "/:id/pay",
  validate([param("id").isUUID(), body("reference").isString().isLength({ min: 4, max: 64 })]),
  postPayment,
);

export default router;
