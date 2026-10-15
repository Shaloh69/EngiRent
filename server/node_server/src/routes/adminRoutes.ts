import { decideFaceReview, listFaceReviews } from "../controllers/faceReviewController";
import { adminConcern, adminConcerns, adminConfirmPayment, adminDecide, adminPreview } from "../controllers/concernController";
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
  releaseRentalForPickup,
  dropRentalToLower,
  refundRenterForRejectedDeposit,
  runCollectionSweepNow,
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
  getKioskLogBacklog,
  getLatestKioskSnapshot,
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
import {
  adminAddNote,
  adminCloseDispute,
  adminDropWrongItem,
  adminGenerateLetter,
  adminGetDispute,
  adminLiftRestriction,
  adminListDisputes,
  adminLogContact,
  adminMarkLetterSubmitted,
  adminMigrateLegacy,
  adminResendPrompt,
  adminSetDeadline,
} from "../controllers/disputeController";
import {
  listAllLockers,
  setLockerService,
  releaseLocker,
  releaseLockerByNumber,
} from "../controllers/kioskController";

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
// E6.R — hand a returned item still in its bay back to its owner in place
// (the D-107 recovery). Moves nothing; the owner opens the bay themselves.
// E6.V — refund a renter whose deposit was rejected before D-109 was fixed.
router.post(
  "/rentals/:id/refund-renter",
  requireAdmin,
  validate([param("id").isUUID()]),
  refundRenterForRejectedDeposit,
);

// Run the hourly R1 collection sweep now (same policy; may drive an actuator).
router.post(
  "/retrieval/sweep",
  requireAdmin,
  validate([body("rentalId").optional().isUUID()]),
  runCollectionSweepNow,
);

router.post(
  "/rentals/:id/release-for-pickup",
  requireAdmin,
  validate([param("id").isUUID()]),
  releaseRentalForPickup,
);

// Move an item waiting up top down to the lower compartment now (same guards as the :15 sweep; drives the actuator).
router.post(
  "/rentals/:id/drop-to-lower",
  requireAdmin,
  validate([param("id").isUUID()]),
  dropRentalToLower,
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

// ── Dispute System v2 (user rulings 2026-10-11) ─────────────────────────────
// ADMIN only: every one of these moves money, a person's standing, or (the
// drop) an actuator. Literal paths before ":id" for the usual reason.
router.get("/disputes", requireAdmin, adminListDisputes);
router.post(
  "/disputes/migrate/:rentalId",
  requireAdmin,
  validate([param("rentalId").isUUID()]),
  adminMigrateLegacy,
);
router.post(
  "/disputes/letters/:letterId/submitted",
  requireAdmin,
  validate([param("letterId").isUUID(), body("note").optional().isString().isLength({ max: 1000 })]),
  adminMarkLetterSubmitted,
);
router.get("/disputes/:id", requireAdmin, validate([param("id").isUUID()]), adminGetDispute);
router.post(
  "/disputes/:id/deadline",
  requireAdmin,
  validate([param("id").isUUID(), body("hours").isIn([24, 48, 72])]),
  adminSetDeadline,
);
router.post(
  "/disputes/:id/contact",
  requireAdmin,
  validate([
    param("id").isUUID(),
    body("audience").isIn(["RENTER", "GUARDIAN", "OWNER", "SAO", "ENGINEERING", "GUIDANCE"]),
    body("channel").isIn(["PHONE", "SMS", "EMAIL", "IN_PERSON", "LETTER"]),
    body("outcome").isIn(["REACHED", "NO_ANSWER", "LEFT_MESSAGE", "WRONG_NUMBER", "SUBMITTED", "OTHER"]),
    body("note").optional().isString().isLength({ max: 2000 }),
  ]),
  adminLogContact,
);
router.post(
  "/disputes/:id/note",
  requireAdmin,
  validate([param("id").isUUID(), body("note").isString().isLength({ min: 1, max: 4000 })]),
  adminAddNote,
);
router.post(
  "/disputes/:id/letters",
  requireAdmin,
  validate([param("id").isUUID(), body("office").isIn(["SAO", "ENGINEERING", "GUIDANCE"])]),
  adminGenerateLetter,
);
router.post(
  "/disputes/:id/close",
  requireAdmin,
  validate([
    param("id").isUUID(),
    body("resolution").isIn(["OVERTURNED", "UNRECOVERED"]),
    body("note").isString().isLength({ min: 5, max: 2000 }),
  ]),
  adminCloseDispute,
);
router.post(
  "/disputes/:id/resend-prompt",
  requireAdmin,
  validate([param("id").isUUID(), body("preface").optional().isString().isLength({ max: 1000 })]),
  adminResendPrompt,
);
// Concerns v2 — reports of problems the camera cannot see (spec SPEC-CONCERNS-V2.md).
router.get("/concerns", requireAdmin, adminConcerns);
router.get("/concerns/:id", requireAdmin, validate([param("id").isUUID()]), adminConcern);
router.post(
  "/concerns/:id/preview",
  requireAdmin,
  validate([param("id").isUUID(), body("pct").isInt({ min: 0, max: 100 }), body("assessedAmount").optional({ nullable: true }).isFloat({ min: 0 })]),
  adminPreview,
);
router.post(
  "/concerns/:id/decide",
  requireAdmin,
  validate([
    param("id").isUUID(),
    body("pct").isInt({ min: 0, max: 100 }),
    body("assessedAmount").optional({ nullable: true }).isFloat({ min: 0 }),
    body("note").isString().isLength({ min: 20, max: 4000 }),
  ]),
  adminDecide,
);
router.post("/concerns/:id/confirm-payment", requireAdmin, validate([param("id").isUUID()]), adminConfirmPayment);
// DRIVES THE ACTUATOR (G11 applies to anyone pressing it): same guards as the sweep.
router.post("/disputes/:id/drop-wrong-item", requireAdmin, validate([param("id").isUUID()]), adminDropWrongItem);
router.post(
  "/users/:userId/lift-restriction",
  requireAdmin,
  validate([param("userId").isUUID(), body("note").isString().isLength({ min: 5, max: 1000 })]),
  adminLiftRestriction,
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

// ── Face re-enrolment review (face liveness, ruling 2026-10-15) ────────────
// Same tier as the ID queue: a reviewer compares a student's photos.
router.get("/face-reviews", requireStaff, listFaceReviews);
router.post(
  "/face-reviews/:id",
  requireStaff,
  validate([
    param("id").isUUID().withMessage("Valid user ID is required"),
    body("decision").isIn(["APPROVE", "REJECT"]).withMessage("decision must be APPROVE or REJECT"),
    body("note").optional().isString().isLength({ max: 500 }),
  ]),
  decideFaceReview,
);

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
router.get("/kiosks/logs", requireAdmin, getKioskLogBacklog); // backlog + ?since polling for the log panel — same ordering reason
// D-86: the console polls for its snapshot, because the event stream never
// reaches the browser through the Cloudflare tunnel.
router.get("/kiosks/snapshots/:lockerNumber/latest", requireAdmin, getLatestKioskSnapshot);
router.get("/kiosks", requireAdmin, listKiosks);

// D-63. The console could release a locker but never see its state: no
// endpoint carried Locker.status to any client. Mounted BEFORE the
// /kiosks/lockers/:id/release routes for the same reason the SSE route is
// mounted before :kioskId — a literal path must not be shadowed by a param.
router.get("/kiosks/lockers", requireAdmin, listAllLockers);

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

// Put a locker into or out of service. Until 2026-09-19 nothing could write
// `isOperational` at all — see setLockerService's doc comment. Admin only
// (not REVIEWER): it changes where students' items are sent.
router.patch(
  "/kiosks/lockers/by-number/:lockerNumber/service",
  requireAdmin,
  validate([
    param("lockerNumber").notEmpty(),
    body("inService").isBoolean(),
    body("reason").optional().isString().isLength({ max: 500 }),
  ]),
  setLockerService,
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
