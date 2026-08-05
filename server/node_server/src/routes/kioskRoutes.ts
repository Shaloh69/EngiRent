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
} from "../controllers/kioskController";
import { authenticate } from "../middleware/auth";
import { requireKioskSecret } from "../middleware/kioskAuth";
import { validate } from "../middleware/validation";
import { uploadMultiple } from "../middleware/upload";

const router = Router();

// Deposit item (protected)
router.post(
  "/deposit",
  authenticate,
  validate([
    body("rentalId").isUUID().withMessage("Valid rental ID is required"),
    body("lockerId").isUUID().withMessage("Valid locker ID is required"),
  ]),
  depositItem,
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

export default router;
