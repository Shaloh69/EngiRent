import { Router } from "express";
import { body } from "express-validator";
import {
  register,
  login,
  refreshToken,
  logout,
  getProfile,
  updateProfile,
  completeProfile,
  changePassword,
  deleteAccount,
  registerFace,
  uploadIdPhoto,
  updatePayoutDestination,
} from "../controllers/authController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validation";
import { uploadSingle } from "../middleware/upload";

const router = Router();

// Register
router.post(
  "/register",
  validate([
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters"),
    body("studentId").notEmpty().withMessage("Student ID is required"),
    body("firstName").notEmpty().withMessage("First name is required"),
    body("lastName").notEmpty().withMessage("Last name is required"),
    body("phoneNumber")
      .isMobilePhone("any")
      .withMessage("Valid phone number is required"),
  ]),
  register,
);

// Login
router.post(
  "/login",
  validate([
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ]),
  login,
);

// Refresh token
router.post(
  "/refresh",
  validate([
    body("refreshToken").notEmpty().withMessage("Refresh token is required"),
  ]),
  refreshToken,
);

// Logout (protected)
router.post("/logout", authenticate, logout);

// Get profile (protected)
router.get("/profile", authenticate, getProfile);

// Update profile (protected)
router.put("/profile", authenticate, updateProfile);

// Complete profile — face/ID photos must already be uploaded via
// /register-face and /id-photo below; this just confirms consent + face
// encoding and flips profileComplete (protected)
router.post("/profile/complete", authenticate, completeProfile);

// Register a face encoding — proxies to the ML service with the server-side
// API key attached (so the mobile app never needs to hold that secret
// itself), and stores the same photo as the user's canonical face/avatar
// image (protected)
router.post("/register-face", authenticate, uploadSingle, registerFace);

// Upload the school-ID photo — private storage, never a client-supplied URL
// (protected)
router.post("/id-photo", authenticate, uploadSingle, uploadIdPhoto);

// Set/update payout destination (bank/e-wallet for rental payouts + deposit
// refunds) — see GET /payments/receiving-institutions for valid bic/
// institutionName pairs to submit here (protected)
router.put(
  "/payout-destination",
  authenticate,
  validate([
    body("provider")
      .isIn(["instapay", "pesonet"])
      .withMessage("provider must be 'instapay' or 'pesonet'"),
    body("bic").notEmpty().withMessage("bic is required"),
    body("institutionName").notEmpty().withMessage("institutionName is required"),
    body("accountName").notEmpty().withMessage("accountName is required"),
    body("accountNumber").notEmpty().withMessage("accountNumber is required"),
  ]),
  updatePayoutDestination,
);

// Change password (protected)
router.put(
  "/password",
  authenticate,
  validate([
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters"),
  ]),
  changePassword,
);

// Delete account — real biometric-data erasure (RA 10173 right to deletion)
// + account deactivation. Requires password re-confirmation. (protected)
router.delete(
  "/account",
  authenticate,
  validate([
    body("password").notEmpty().withMessage("Password is required"),
  ]),
  deleteAccount,
);

export default router;
