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
  settleDispute,
  listTransactions,
  adminRefund,
  listVerifications,
  reviewVerification,
  getKioskConfig,
  updateKioskConfig,
  sendKioskCommand,
  listKiosks,
  kioskEventStream,
  getReports,
  getSystemHealth,
  listIdVerifications,
  decideIdVerification,
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

router.post(
  "/rentals/:id/settle",
  validate([
    param("id").isUUID(),
    body("outcome").isIn(["owner_wins", "renter_wins"]),
  ]),
  settleDispute,
);

// ── Transactions ──────────────────────────────────────────────────────────
router.get("/transactions", listTransactions);

router.post(
  "/transactions/:transactionId/refund",
  validate([param("transactionId").isUUID()]),
  adminRefund,
);

// ── Verifications ──────────────────────────────────────────────────────────
// AI condition checks on rentals (deposit vs return photos). Named
// "verifications" historically; the student-ID queue below is a different
// thing and the collision hid its absence entirely (mandate §2.11).
router.get("/verifications", listVerifications);

// ── Student ID verification ────────────────────────────────────────────
router.get("/id-verifications", listIdVerifications);

router.post(
  "/id-verifications/:id",
  validate([
    param("id").isUUID().withMessage("Valid user ID is required"),
    body("decision")
      .isIn(["APPROVE", "REJECT"])
      .withMessage("decision must be APPROVE or REJECT"),
    body("reason").optional().isString(),
    body("note").optional().isString().isLength({ max: 500 }),
  ]),
  decideIdVerification,
);

router.patch(
  "/verifications/:id",
  validate([
    param("id").isUUID(),
    body("status").isIn(["APPROVED", "REJECTED"]),
  ]),
  reviewVerification,
);

// ── Reports ────────────────────────────────────────────────────────────────
router.get("/reports", getReports);

// ── System health (PC-side software Components Check) ─────────────────────
router.get("/health", getSystemHealth);

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
