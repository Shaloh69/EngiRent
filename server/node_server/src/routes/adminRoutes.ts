import { Router } from "express";
import { body, param } from "express-validator";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validate } from "../middleware/validation";
import {
  getStats,
  listUsers,
  updateUser,
  createAdmin,
  listAllRentals,
  forceCompleteRental,
  listVerifications,
  reviewVerification,
  getKioskConfig,
  updateKioskConfig,
  sendKioskCommand,
  listKiosks,
  kioskEventStream,
} from "../controllers/adminController";

const router = Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// ── Dashboard ──────────────────────────────────────────────────────────────
router.get("/stats", getStats);

// ── Users ──────────────────────────────────────────────────────────────────
router.get("/users", listUsers);

router.patch("/users/:id", validate([param("id").isUUID()]), updateUser);

router.post(
  "/users/admin",
  validate([
    body("email").isEmail(),
    body("password").isLength({ min: 8 }),
    body("studentId").notEmpty(),
    body("firstName").notEmpty(),
    body("lastName").notEmpty(),
    body("phoneNumber").notEmpty(),
  ]),
  createAdmin,
);

// ── Rentals ────────────────────────────────────────────────────────────────
router.get("/rentals", listAllRentals);

router.post(
  "/rentals/:id/complete",
  validate([param("id").isUUID()]),
  forceCompleteRental,
);

// ── Verifications ──────────────────────────────────────────────────────────
router.get("/verifications", listVerifications);

router.patch(
  "/verifications/:id",
  validate([
    param("id").isUUID(),
    body("status").isIn(["APPROVED", "REJECTED"]),
  ]),
  reviewVerification,
);

// ── Kiosk management ──────────────────────────────────────────────────────
router.get("/kiosks/events", kioskEventStream); // SSE — must be before :kioskId routes
router.get("/kiosks", listKiosks);

router.get(
  "/kiosks/:kioskId/config",
  validate([param("kioskId").notEmpty()]),
  getKioskConfig,
);

router.put(
  "/kiosks/:kioskId/config",
  validate([param("kioskId").notEmpty(), body("config").isObject()]),
  updateKioskConfig,
);

router.post(
  "/kiosks/:kioskId/command",
  validate([param("kioskId").notEmpty(), body("action").notEmpty()]),
  sendKioskCommand,
);

export default router;
