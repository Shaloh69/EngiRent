import { Router } from "express";
import { body } from "express-validator";
import {
  depositItem,
  claimItem,
  returnItem,
  getAvailableLockers,
  releaseLocker,
  startKioskSession,
  uploadKioskImages,
  verifyFaceFromApp,
  openBay,
  itemPlaced,
} from "../controllers/kioskController";
import { authenticate } from "../middleware/auth";
import { requireKioskSecret } from "../middleware/kioskAuth";
import { isKioskTarget } from "../middleware/restriction";
import { validate } from "../middleware/validation";
import { uploadMultiple, uploadSingle } from "../middleware/upload";

const router = Router();

// Deposit item (protected)
router.post(
  "/deposit",
  authenticate,
  validate([
    body("rentalId").isUUID().withMessage("Valid rental ID is required"),
    // Optional by design — depositItem() falls back to the first AVAILABLE
    // locker when omitted. Previously required here, which made that
    // fallback unreachable through the real API (found 2026-09-03, tracing
    // the real deposit flow to build a full lifecycle test).
    body("lockerId").optional().isUUID().withMessage("lockerId must be a valid UUID if provided"),
  ]),
  depositItem,
);

// The two taps that drive a bay once a face has verified (2026-09-14).
// Neither takes a kiosk, a bay or a door from the request: those come from the
// server-side grant made by the verification itself (kioskBayAccessStore.ts),
// which is the same trust shape as the QR session it follows.
// Dispute v2: `rentalId` may also be `wi:<disputeId>` (the renter collecting
// their own wrong item); the grant store is keyed by the same string.
router.post(
  "/open-bay",
  authenticate,
  validate([body("rentalId").custom(isKioskTarget).withMessage("Valid rental ID is required")]),
  openBay,
);

router.post(
  "/item-placed",
  authenticate,
  validate([body("rentalId").isUUID().withMessage("Valid rental ID is required")]),
  itemPlaced,
);

// Claim item (protected)
router.post(
  "/claim",
  authenticate,
  validate([
    body("rentalId").isUUID().withMessage("Valid rental ID is required"),
  ]),
  claimItem,
);

// Return item (protected)
router.post(
  "/return",
  authenticate,
  validate([
    body("rentalId").isUUID().withMessage("Valid rental ID is required"),
    body("lockerId").isUUID().withMessage("Valid locker ID is required"),
    body("images").isArray().withMessage("Images array is required"),
  ]),
  returnItem,
);

// Get available lockers (protected)
router.get("/lockers", authenticate, getAvailableLockers);

// Release a locker (admin or kiosk service)
router.post("/lockers/:id/release", authenticate, releaseLocker);

// App submits scanned kiosk QR token to start a kiosk session
router.post(
  "/session/start",
  authenticate,
  validate([
    body("token").notEmpty().withMessage("token is required"),
    body("kioskId").notEmpty().withMessage("kioskId is required"),
  ]),
  startKioskSession,
);

// Kiosk uploads captured images directly (not via the mobile app's JWT auth —
// the Pi has no user identity, only its shared secret). Replaces the kiosk
// uploading straight to Supabase (see uploadKioskImages() doc comment).
router.post(
  "/upload",
  requireKioskSecret,
  uploadMultiple,
  uploadKioskImages,
);

// Face verification from the phone (protected).
//
// Replaces the kiosk's removed face camera — the app captures, this server
// decides. `uploadSingle` parses the multipart body, so the validator below
// sees rentalId as an ordinary field. There is deliberately no `token` field
// here: which kiosk this belongs to comes only from a session the kiosk
// itself opened after validating the scanned QR (see kioskSessionStore.ts) —
// trusting a client-supplied token for that would defeat the whole point of
// the session binding. Deliberately NOT rate-limited into uselessness: a
// real person who is badly lit will retry several times, and locking them
// out at a kiosk is worse than the marginal brute-force risk against a
// biometric match that already fails closed (and is itself capped at 4
// attempts per session — see kioskSessionStore.ts).
router.post(
  "/verify-face",
  authenticate,
  uploadSingle,
  validate([
    body("rentalId").custom(isKioskTarget).withMessage("Valid rental ID is required"),
  ]),
  verifyFaceFromApp,
);

export default router;
