import { Router } from "express";
import { body, param } from "express-validator";
import {
  createPayment,
  confirmPayment,
  getPaymentStatus,
  getTransactions,
  refundPayment,
  getReceivingInstitutions,
  gatewayEvent,
} from "../controllers/paymentController";
import { authenticate, requireAdmin, requireVerified } from "../middleware/auth";
import { blockIfRestricted } from "../middleware/restriction";
import { validate } from "../middleware/validation";

const router = Router();

// Create payment (protected). Note: the amount is derived server-side from
// the rental record (see paymentController.createPayment) — there is
// deliberately no client-supplied "amount" field here to validate.
// Ruling 1 + 3 (Dispute v2): verified UCLM students only, and not while
// restricted (a dispute fee is paid at the kiosk, never here).
router.post(
  "/",
  authenticate,
  requireVerified,
  blockIfRestricted,
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

// A PayMongo webhook forwarded by the payment gateway (SPEC-PAYMENT-GATEWAY.md
// §3.3). No `authenticate`: gatewayEvent checks the gateway's HMAC signature
// and timestamp, then re-checks the checkout with PayMongo before anything.
router.post("/gateway-event", gatewayEvent);

// Get transactions (protected)
router.get("/", authenticate, getTransactions);

// Poll a single transaction's status (protected) — used by the Phone App's
// checkout WebView as a fallback to redirect-navigation detection.
router.get("/status/:transactionId", authenticate, getPaymentStatus);

// List real PayMongo-recognized banks/e-wallets for a payout rail (protected)
// — used to populate the payout-destination picker in PUT /auth/payout-destination
router.get("/receiving-institutions", authenticate, getReceivingInstitutions);

// Refund payment — ADMIN ONLY.
//
// SECURITY FIX 2026-10-11: this was `authenticate` alone, and refundPayment
// checks neither ownership nor role, so ANY logged-in student could refund ANY
// completed transaction: their own rental payment after collecting the item,
// or someone else's. With PayMongo now primary that is real money. No client
// calls this route (the admin console uses /admin/transactions/:id/refund), so
// closing it to admins breaks nothing.
router.post(
  "/:transactionId/refund",
  authenticate,
  requireAdmin,
  validate([
    param("transactionId")
      .isUUID()
      .withMessage("Valid transaction ID is required"),
  ]),
  refundPayment,
);

export default router;
