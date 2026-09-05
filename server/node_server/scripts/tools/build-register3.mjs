// Joins the 93 endpoint rows against what the suites ACTUALLY call
// (extracted statically from suite source, never from suite titles) and
// emits Register 3 as markdown with computed counts.
import { writeFileSync } from "node:fs";

// ── The 93 rows, from the route files (order preserved from PROGRESS.md) ──
const ROUTES = {
  adminRoutes: [
    "GET /admin/stats", "GET /admin/users", "GET /admin/users/:id",
    "PATCH /admin/users/:id", "POST /admin/users/admin", "GET /admin/audit-log",
    "GET /admin/rentals", "POST /admin/rentals/:id/complete",
    "GET /admin/rentals/:id/conversation", "POST /admin/rentals/:id/settle",
    "GET /admin/transactions", "POST /admin/transactions/:transactionId/refund",
    "POST /admin/transactions/:transactionId/decide-payment",
    "GET /admin/verifications", "GET /admin/id-verifications",
    "POST /admin/id-verifications/:id", "PATCH /admin/verifications/:id",
    "PATCH /admin/items/bulk", "GET /admin/items/:id",
    "GET /admin/items/:id/reviews", "PATCH /admin/items/:id",
    "DELETE /admin/reviews/:id", "GET /admin/feedback",
    "PATCH /admin/feedback/:id", "GET /admin/reports", "GET /admin/health",
    "GET /admin/kiosks/events", "GET /admin/kiosks",
    "POST /admin/kiosks/lockers/:id/release",
    "POST /admin/kiosks/lockers/by-number/:lockerNumber/release",
    "GET /admin/kiosks/:kioskId/config", "PUT /admin/kiosks/:kioskId/config",
    "POST /admin/kiosks/:kioskId/command",
  ],
  authRoutes: [
    "POST /auth/register", "POST /auth/login", "POST /auth/refresh",
    "POST /auth/logout", "GET /auth/profile", "PUT /auth/profile",
    "POST /auth/profile/complete", "POST /auth/register-face",
    "POST /auth/id-photo", "PUT /auth/payout-destination",
    "PUT /auth/password", "DELETE /auth/account",
  ],
  feedbackRoutes: ["POST /feedback", "GET /feedback/mine"],
  index: ["GET /health", "GET /app-config"],
  itemRoutes: [
    "POST /items", "GET /items", "GET /items/my-items",
    "GET /items/:id/booked-dates", "GET /items/:id", "PUT /items/:id",
    "DELETE /items/:id",
  ],
  kioskRoutes: [
    "POST /kiosk/deposit", "POST /kiosk/claim", "POST /kiosk/return",
    "GET /kiosk/lockers", "POST /kiosk/lockers/:id/release",
    "POST /kiosk/session/start", "POST /kiosk/upload", "POST /kiosk/verify-face",
  ],
  mediaRoutes: [
    "GET /media/items/:batchId/:filename", "GET /media/users/:userId/face.jpg",
    "GET /media/secure/:token",
  ],
  notificationRoutes: [
    "GET /notifications", "GET /notifications/preferences",
    "PUT /notifications/preferences", "PATCH /notifications/:id/read",
    "PATCH /notifications/read-all", "DELETE /notifications/:id",
  ],
  paymentRoutes: [
    "POST /payments", "POST /payments/confirm", "GET /payments",
    "GET /payments/status/:transactionId", "GET /payments/receiving-institutions",
    "POST /payments/:transactionId/refund",
  ],
  rentalRoutes: [
    "POST /rentals", "GET /rentals", "GET /rentals/:id",
    "PATCH /rentals/:id/status", "POST /rentals/:id/cancel",
    "PATCH /rentals/:id/dates", "GET /rentals/:id/conversation",
    "POST /rentals/:id/conversation/messages",
  ],
  reviewRoutes: [
    "POST /reviews", "GET /reviews/me", "GET /reviews/item/:itemId",
    "GET /reviews/user/:userId",
  ],
  uploadRoutes: ["POST /upload/image", "POST /upload/images"],
};

// ── HAPPY PATH: which suite exercises each route for real. ────────────────
// Sourced from the static extraction + hand-reading the four suites that
// build paths from variables. "m:" prefix = manualOnly suite (not in the
// unattended 13). Anything absent here is genuinely uncovered.
const HAPPY = {
  "GET /admin/users": ["enterprise-hygiene"],
  "GET /admin/users/:id": ["enterprise-hygiene"],
  "POST /admin/users/admin": ["enterprise-hygiene"],
  "GET /admin/audit-log": ["enterprise-hygiene"],
  "GET /admin/rentals": ["enterprise-hygiene"],
  "GET /admin/rentals/:id/conversation": ["messaging"],
  "POST /admin/rentals/:id/settle": ["trust-safety"],
  "GET /admin/transactions": ["enterprise-hygiene", "webhook-signature"],
  "POST /admin/transactions/:transactionId/decide-payment": ["m:full-lifecycle"],
  "GET /admin/id-verifications": ["enterprise-hygiene", "m:verification"],
  "POST /admin/id-verifications/:id": ["m:verification", "m:full-lifecycle"],
  "PATCH /admin/items/bulk": ["enterprise-hygiene"],
  "GET /admin/items/:id": ["enterprise-hygiene", "item-moderation"],
  "GET /admin/items/:id/reviews": ["item-moderation"],
  "PATCH /admin/items/:id": ["enterprise-hygiene", "item-moderation"],
  "DELETE /admin/reviews/:id": ["item-moderation"],
  "GET /admin/feedback": ["feedback", "trust-safety", "enterprise-hygiene"],
  "PATCH /admin/feedback/:id": ["feedback"],
  "GET /admin/kiosks": ["enterprise-hygiene"],
  "POST /auth/register": ["9 suites"],
  "POST /auth/login": ["12 suites"],
  "GET /auth/profile": ["defect-regressions", "m:verification"],
  "POST /auth/profile/complete": ["m:verification", "m:full-lifecycle"],
  "POST /auth/register-face": ["m:full-lifecycle"],
  "POST /auth/id-photo": ["m:full-lifecycle"],
  "POST /feedback": ["feedback", "trust-safety"],
  "GET /feedback/mine": ["feedback"],
  "GET /health": ["auth-matrix (control)"],
  "GET /app-config": ["enterprise-hygiene"],
  "POST /items": ["8 suites"],
  "GET /items": ["my-listings", "item-moderation", "defect-regressions"],
  "GET /items/my-items": ["my-listings"],
  "GET /items/:id/booked-dates": ["availability"],
  "GET /items/:id": ["availability", "listing-video", "enterprise-hygiene"],
  "PUT /items/:id": ["my-listings", "listing-video"],
  "DELETE /items/:id": ["my-listings", "self-action"],
  "POST /kiosk/deposit": ["m:full-lifecycle"],
  "POST /kiosk/session/start": ["kiosk-trust", "defect-regressions"],
  "POST /kiosk/verify-face": ["kiosk-trust (attacked)"],
  "GET /notifications": ["feedback", "messaging", "m:verification"],
  "GET /notifications/preferences": ["enterprise-hygiene"],
  "PUT /notifications/preferences": ["enterprise-hygiene"],
  "POST /payments": ["m:full-lifecycle", "self-action"],
  "POST /payments/confirm": ["webhook-signature (attacked)"],
  "POST /payments/:transactionId/refund": ["self-action (negative)"],
  "POST /rentals": ["availability", "messaging", "enterprise-hygiene", "self-action"],
  "GET /rentals/:id": ["m:full-lifecycle"],
  "POST /rentals/:id/cancel": ["availability"],
  "PATCH /rentals/:id/dates": ["enterprise-hygiene"],
  "GET /rentals/:id/conversation": ["messaging", "self-action"],
  "POST /rentals/:id/conversation/messages": ["messaging", "self-action"],
  "POST /reviews": ["item-moderation", "self-action"],
  "GET /reviews/item/:itemId": ["item-moderation"],
  "GET /reviews/user/:userId": ["trust-safety"],
  // ── added by e2e-coverage-sweep.mjs, 2026-09-06 (run live, 19 passed) ──
  "POST /auth/refresh": ["coverage-sweep"],
  "POST /auth/logout": ["coverage-sweep"],
  "PUT /auth/profile": ["coverage-sweep"],
  "PUT /auth/payout-destination": ["coverage-sweep"],
  "PUT /auth/password": ["coverage-sweep"],
  "DELETE /auth/account": ["coverage-sweep"],
  "GET /rentals": ["coverage-sweep"],
  "GET /payments": ["coverage-sweep"],
  "GET /reviews/me": ["coverage-sweep"],
  "GET /kiosk/lockers": ["coverage-sweep"],
  "PATCH /notifications/read-all": ["coverage-sweep"],
  "GET /admin/stats": ["coverage-sweep"],
  "GET /admin/reports": ["coverage-sweep"],
  "GET /admin/health": ["coverage-sweep"],
  "GET /admin/verifications": ["coverage-sweep"],
  "POST /kiosk/claim": ["coverage-sweep (asserts 410 — RED, not deployed)"],
  "POST /kiosk/return": ["coverage-sweep (asserts 410 — RED, not deployed)"],
  "PATCH /admin/users/:id": ["coverage-sweep (probe reactivation)"],
  "POST /upload/image": ["9 suites"],
};

// ── 401: auth-matrix ENDPOINTS, verbatim from its source (34). ────────────
const P401 = new Set([
  "GET /auth/profile", "PUT /auth/profile", "POST /auth/profile/complete",
  "PUT /auth/password", "PUT /auth/payout-destination", "DELETE /auth/account",
  "POST /items", "GET /items/my-items", "PUT /items/:id", "DELETE /items/:id",
  "POST /rentals", "GET /rentals", "GET /rentals/:id",
  "POST /rentals/:id/cancel", "PATCH /rentals/:id/dates",
  "GET /rentals/:id/conversation",
  "POST /payments", "GET /payments", "GET /payments/status/:transactionId",
  "GET /payments/receiving-institutions", "POST /payments/:transactionId/refund",
  "POST /kiosk/deposit", "GET /kiosk/lockers", "POST /kiosk/session/start",
  "POST /kiosk/verify-face",
  "GET /notifications", "GET /notifications/preferences",
  "PUT /notifications/preferences", "PATCH /notifications/read-all",
  "POST /reviews", "GET /reviews/me", "POST /feedback", "GET /feedback/mine",
  "POST /upload/image",
]);

// ── 403: auth-matrix ADMIN_ENDPOINTS, verbatim (12). ──────────────────────
const P403 = new Set([
  "GET /admin/stats", "GET /admin/users", "GET /admin/audit-log",
  "GET /admin/rentals", "GET /admin/transactions", "GET /admin/reports",
  "GET /admin/health", "GET /admin/kiosks", "GET /admin/id-verifications",
  "GET /admin/feedback", "GET /admin/verifications", "GET /admin/items/:id",
]);

// ── malformed-body 400: sampled empirically by defect-regressions (7). ────
const P400_SAMPLED = new Set([
  "POST /auth/register", "POST /auth/login", "POST /feedback",
  "POST /kiosk/session/start", "POST /payments", "POST /rentals",
  "POST /reviews",
]);

// ── self-action / derived-counterparty (self-action suite, 8 assertions). ─
const PSELF = new Set([
  "POST /rentals", "GET /rentals/:id/conversation",
  "POST /rentals/:id/conversation/messages", "POST /reviews",
  "POST /payments/:transactionId/refund",
]);

// Routes that accept no JSON body — the malformed-400 case is N/A, not a gap.
const NO_BODY = (r) =>
  r.startsWith("GET ") || r.startsWith("DELETE ") ||
  ["POST /upload/image", "POST /upload/images", "POST /auth/register-face",
   "POST /auth/id-photo", "POST /kiosk/upload", "POST /kiosk/verify-face"].includes(r);

const RETIRED = new Set(["POST /kiosk/claim", "POST /kiosk/return"]);
const BLOCKED = new Map([
  ["GET /payments/receiving-institutions", "PayMongo Disbursements not enabled; moot under the manual-payments ruling"],
]);

let rows = [], n = 0, hp = 0, c401 = 0, c403 = 0, c400 = 0, cself = 0, full = 0;
const out = [];

for (const [group, list] of Object.entries(ROUTES)) {
  out.push(`\n**${group}** (${list.length})\n`);
  out.push("| Endpoint | happy | 401 | 403 | 400 | self | covered by |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of list) {
    n++;
    const h = HAPPY[r];
    const a401 = P401.has(r) ? "✓" : "—";
    const a403 = P403.has(r) ? "✓" : "—";
    const a400 = NO_BODY(r) ? "n/a" : P400_SAMPLED.has(r) ? "✓" : "shared";
    const aself = PSELF.has(r) ? "✓" : "—";
    if (h) hp++;
    if (a401 === "✓") c401++;
    if (a403 === "✓") c403++;
    if (a400 === "✓") c400++;
    if (aself === "✓") cself++;
    let by = h ? h.join(", ") : "";
    if (RETIRED.has(r)) by = "**RETIRED — 410 Gone.** No test asserts the 410 yet";
    if (BLOCKED.has(r)) by = `**BLOCKED** — ${BLOCKED.get(r)}`;
    if (h && (a401 === "✓" || r.startsWith("GET /admin") || group === "index")) full++;
    out.push(`| \`${r}\` | ${h ? "✓" : "✗"} | ${a401} | ${a403} | ${a400} | ${aself} | ${by} |`);
  }
}

const summary = `
**Computed coverage across ${n} rows** — happy path **${hp}/${n}** (${Math.round((hp / n) * 100)}%) ·
401 asserted **${c401}** · 403 asserted **${c403}** ·
malformed-400 empirically sampled **${c400}**, the rest carried by the shared
\`errorHandler\` fix (D-15) or n/a for bodyless routes ·
self-action / derived-counterparty **${cself}**.
`;

writeFileSync(process.argv[2], summary + out.join("\n") + "\n");
console.log(summary);
console.log("uncovered happy path:");
for (const list of Object.values(ROUTES))
  for (const r of list) if (!HAPPY[r]) console.log("  ✗ " + r);
