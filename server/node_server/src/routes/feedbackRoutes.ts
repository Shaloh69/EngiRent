import { Router } from "express";
import { body } from "express-validator";
import { submitFeedback, getMyFeedback } from "../controllers/feedbackController";
import { authenticate } from "../middleware/auth";
import { uploadSingle } from "../middleware/upload";
import { validate } from "../middleware/validation";
import { createPerUserRateLimiter } from "../middleware/perUserRateLimiter";

const router = Router();

// Stricter than the global IP-keyed limiter (rateLimiter.ts) on purpose —
// see perUserRateLimiter's doc comment for why a shared-NAT campus network
// makes an IP-keyed limit the wrong shape for this specific endpoint.
const feedbackRateLimiter = createPerUserRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "You've submitted several reports recently. Please wait before sending another.",
});

router.post(
  "/",
  authenticate,
  feedbackRateLimiter,
  uploadSingle, // optional screenshot under field "file"; req.file is undefined if omitted
  validate([
    body("category").notEmpty().withMessage("category is required"),
    body("body").notEmpty().withMessage("A description is required"),
  ]),
  submitFeedback,
);

router.get("/mine", authenticate, getMyFeedback);

export default router;
