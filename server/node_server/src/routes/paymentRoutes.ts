import { Router } from "express";
import { body, param } from "express-validator";
import {
  createPayment,
  confirmPayment,
  getTransactions,
  refundPayment,
  getReceivingInstitutions,
} from "../controllers/paymentController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";

const router = Router();

// Create payment (protected). Note: the amount is derived server-side from
// the rental record (see paymentController.createPayment) — there is
// deliberately no client-supplied "amount" field here to validate.
router.post(
  "/",
  authenticate,
  validate([
    body("rentalId").isUUID().withMessage("Valid rental ID is required"),
    body("type")
      .isIn(["RENTAL_PAYMENT", "SECURITY_DEPOSIT"])
      .withMessage("type must be RENTAL_PAYMENT or SECURITY_DEPOSIT"),
  ]),
  createPayment,
);

// Confirm payment (real PayMongo webhook, or a manual/dev call outside
// production). The two shapes share almost no fields — a real webhook nests
// everything under body.data.attributes and never sends `transactionId` or
// `gcashReferenceNo` at the top level — so field validation happens inside
// confirmPayment itself rather than here; a blanket top-level-field
// validator previously rejected every genuine webhook before it reached the
// controller. No `authenticate` here by design (PayMongo can't send a user
// JWT); confirmPayment enforces signature verification instead.
router.post("/confirm", confirmPayment);

// Get transactions (protected)
router.get("/", authenticate, getTransactions);

// List real PayMongo-recognized banks/e-wallets for a payout rail (protected)
// — used to populate the payout-destination picker in PUT /auth/payout-destination
router.get("/receiving-institutions", authenticate, getReceivingInstitutions);

// Refund payment (protected)
router.post(
  "/:transactionId/refund",
  authenticate,
  validate([
    param("transactionId")
      .isUUID()
      .withMessage("Valid transaction ID is required"),
  ]),
  refundPayment,
);

export default router;
