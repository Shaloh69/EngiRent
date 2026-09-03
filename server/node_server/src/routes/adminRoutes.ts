import { Router } from "express";
import { body, param } from "express-validator";
import { authenticate, requireAdmin, requireStaff } from "../middleware/auth";
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
  adminDecidePayment,
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
  listFeedback,
  updateFeedbackStatus,
  getItemDetail,
  getItemReviewsAdmin,
  moderateItem,
  deleteReview,
  listAuditLog,
  getUserDetail,
  bulkModerateItems,
} from "../controllers/adminController";
import { getConversationForAdmin } from "../controllers/messageController";
import { releaseLocker, releaseLockerByNumber } from "../controllers/kioskController";

const router = Router();

// All admin routes require authentication; role granularity (checklist
// Stage 9) is applied per-route below via requireAdmin (ADMIN only) or
// requireStaff (ADMIN or REVIEWER) — not a single blanket check anymore.
// A REVIEWER can clear the ID-verification/item-moderation/feedback
// queues; everything money-, kiosk-, user-, or audit-related stays
// requireAdmin-only.
router.use(authenticate);

// ── Dashboard ──────────────────────────────────────────────────────────────
router.get("/stats", requireAdmin, getStats);

// ── Users ──────────────────────────────────────────────────────────────────
router.get("/users", requireAdmin, listUsers);

router.get(
  "/users/:id",
  requireAdmin,
  validate([param("id").isUUID()]),
  getUserDetail,
);

router.patch("/users/:id", requireAdmin, validate([param("id").isUUID()]), updateUser);

router.post(
  "/users/admin",
  requireAdmin,
  validate([
    body("email").isEmail(),
    body("password").isLength({ min: 8 }),
    body("studentId").notEmpty(),
    body("firstName").notEmpty(),
    body("lastName").notEmpty(),
    body("phoneNumber").notEmpty(),
    body("role").optional().isIn(["ADMIN", "REVIEWER"]),
  ]),
  createAdmin,
);

// ── Audit log (checklist Stage 9) ───────────────────────────────────────────
// Reveals what other staff have done — ADMIN-only, not REVIEWER-visible.
router.get("/audit-log", requireAdmin, listAuditLog);

// ── Rentals ────────────────────────────────────────────────────────────────
router.get("/rentals", requireAdmin, listAllRentals);

router.post(
  "/rentals/:id/complete",
  requireAdmin,
  validate([param("id").isUUID()]),
  forceCompleteRental,
);

// Checklist Stage 5 — "attach the transcript to disputes": the reason this
// ranks above general chat features. Read-only, no participant check — an
// admin reviewing a dispute is not one of the two people in it.
router.get(
  "/rentals/:id/conversation",
  requireAdmin,
  validate([param("id").isUUID()]),
  getConversationForAdmin,
);

router.post(
  "/rentals/:id/settle",
  requireAdmin,
  validate([
    param("id").isUUID(),
    body("outcome").isIn(["owner_wins", "renter_wins"]),
  ]),
  settleDispute,
);

// ── Transactions ──────────────────────────────────────────────────────────
router.get("/transactions", requireAdmin, listTransactions);

router.post(
  "/transactions/:transactionId/refund",
  requireAdmin,
  validate([param("transactionId").isUUID()]),
  adminRefund,
);

// Manual PayMongo bypass, testing only — see adminController.adminDecidePayment
// for the full reasoning. requireAdmin (not requireStaff): this moves money-
// adjacent state, same tier as refunds above, not REVIEWER territory.
router.post(
  "/transactions/:transactionId/decide-payment",
  requireAdmin,
  validate([
    param("transactionId").isUUID(),
    body("decision").optional().isIn(["APPROVE", "REJECT"]),
  ]),
  adminDecidePayment,
);

// ── Verifications ──────────────────────────────────────────────────────────
// AI condition checks on rentals (deposit vs return photos). Named
// "verifications" historically; the student-ID queue below is a different
// thing and the collision hid its absence entirely (mandate §2.11).
router.get("/verifications", requireAdmin, listVerifications);

// ── Student ID verification (checklist Stage 9 — REVIEWER-eligible) ────────
router.get("/id-verifications", requireStaff, listIdVerifications);

router.post(
  "/id-verifications/:id",
  requireStaff,
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
  requireAdmin,
  validate([
    param("id").isUUID(),
    body("status").isIn(["APPROVED", "REJECTED"]),
  ]),
  reviewVerification,
);

// ── Item detail, ratings, moderation (checklist Stage 3.6/9 — REVIEWER-eligible) ──
// Checklist Stage 9 — bulk moderation. Registered *before* the "/items/:id"
// routes below: Express matches route patterns in registration order, and
// "bulk" is a syntactically valid value for a ":id" param — with the
// parameterized route registered first, every /items/bulk request would
// have been swallowed by "/items/:id" and 400'd on param("id").isUUID().
// "Moderating a spam wave" was previously one row at a time; RESTORE is
// deliberately excluded from the bulk action set (a soft-deleted item's
// restoration is rare/manual enough not to need a bulk path, and keeping
// the action list short avoids a destructive-looking bulk
// RESTORE-everything footgun).
router.patch(
  "/items/bulk",
  requireStaff,
  validate([
    body("itemIds").isArray({ min: 1, max: 100 }),
    body("itemIds.*").isUUID(),
    body("action").isIn(["UNLIST", "RELIST", "FLAG", "UNFLAG"]),
    body("reason").optional().isString().isLength({ max: 1000 }),
  ]),
  bulkModerateItems,
);

router.get("/items/:id", requireStaff, validate([param("id").isUUID()]), getItemDetail);

router.get(
  "/items/:id/reviews",
  requireStaff,
  validate([param("id").isUUID()]),
  getItemReviewsAdmin,
);

router.patch(
  "/items/:id",
  requireStaff,
  validate([
    param("id").isUUID(),
    body("action").isIn(["UNLIST", "RELIST", "FLAG", "UNFLAG", "RESTORE"]),
    body("reason").optional().isString().isLength({ max: 1000 }),
  ]),
  moderateItem,
);

router.delete(
  "/reviews/:id",
  requireAdmin,
  validate([
    param("id").isUUID(),
    body("reason").notEmpty().isString().isLength({ max: 1000 }),
  ]),
  deleteReview,
);

// ── Feedback triage (checklist Stage 3.3/9 — REVIEWER-eligible) ────────────
// Without this the submission endpoint was a write-only hole: reports could
// be filed but nothing on the admin side could read them.
router.get("/feedback", requireStaff, listFeedback);

router.patch(
  "/feedback/:id",
  requireStaff,
  validate([
    param("id").isUUID(),
    body("status").isIn(["ACKNOWLEDGED", "RESOLVED"]),
    body("note").optional().isString().isLength({ max: 2000 }),
    body("fixedInVersion").optional().isString().isLength({ max: 32 }),
  ]),
  updateFeedbackStatus,
);

// ── Reports ────────────────────────────────────────────────────────────────
router.get("/reports", requireAdmin, getReports);

// ── System health (PC-side software Components Check) ─────────────────────
router.get("/health", requireAdmin, getSystemHealth);

// ── Kiosk management ──────────────────────────────────────────────────────
router.get("/kiosks/events", requireAdmin, kioskEventStream); // SSE — must be before :kioskId routes
router.get("/kiosks", requireAdmin, listKiosks);

// Checklist Stage 9 — the release endpoint itself already existed
// (kioskController.ts's releaseLocker, POST /kiosk/lockers/:id/release,
// its own inline ADMIN-or-participant check) and needed zero server
// changes; this just exposes the same call under /admin for the kiosk
// page's "stuck locker" support action, consistent with every other
// action on this page living under /admin.
router.post(
  "/kiosks/lockers/:id/release",
  requireAdmin,
  validate([param("id").isUUID()]),
  releaseLocker,
);

// The kiosk admin page works in terms of locker numbers, not database ids
// — see releaseLockerByNumber's doc comment.
router.post(
  "/kiosks/lockers/by-number/:lockerNumber/release",
  requireAdmin,
  validate([param("lockerNumber").notEmpty()]),
  releaseLockerByNumber,
);

router.get(
  "/kiosks/:kioskId/config",
  requireAdmin,
  validate([param("kioskId").notEmpty()]),
  getKioskConfig,
);

router.put(
  "/kiosks/:kioskId/config",
  requireAdmin,
  validate([param("kioskId").notEmpty(), body("config").isObject()]),
  updateKioskConfig,
);

router.post(
  "/kiosks/:kioskId/command",
  requireAdmin,
  validate([param("kioskId").notEmpty(), body("action").notEmpty()]),
  sendKioskCommand,
);

export default router;
