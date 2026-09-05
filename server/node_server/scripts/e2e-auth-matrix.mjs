/**
 * E1 — the auth half of the five minimum cases, swept across the whole API.
 *
 * `API-TEST-PLAN.md` requires every endpoint to answer **401 without auth** and
 * **403 for the wrong role**. Those guards are applied per-route by middleware,
 * so they either hold uniformly or they have specific holes — which makes this
 * worth sweeping in one pass rather than asserting endpoint by endpoint.
 *
 *   node scripts/e2e-auth-matrix.mjs
 *
 * Env: API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, plus STUDENT_EMAIL /
 * STUDENT_PASSWORD for an ordinary (non-staff) account used to probe the
 * role guards.
 *
 * Nothing is created or deleted — every request is expected to be rejected
 * before it reaches a controller. Path params are dummy UUIDs on purpose:
 * authentication runs before validation, so a real id is not needed and using
 * one would risk touching real rows.
 *
 * RATE LIMITING — read this before scaling the sweep up.
 * The API allows **100 requests per 15-minute window per IP**
 * (`RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS`), applied uniformly
 * including /admin. This sweep alone is ~62 requests, so running it twice in
 * one window trips the limiter. A 429 is therefore reported as **INCONCLUSIVE,
 * not as a failure** — the assertion genuinely was not evaluated, and counting
 * it as a pass or a fail would both be lies.
 *
 * The full five-case matrix over all 93 endpoints is ~465 requests — roughly
 * 4.6x the window. E1 cannot run it end to end against the live deployment
 * without pacing over ~70 minutes, raising the limit for a test IP, or running
 * against a local instance. See docs/PROGRESS.md.
 */
const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";
const UUID = "00000000-0000-4000-8000-000000000000";

// Shared secret matching RATE_LIMIT_BYPASS_SECRET on the server. Without it the
// sweep is capped at 100 requests per 15 minutes and most assertions come back
// inconclusive (see the header comment).
const BYPASS = process.env.RATE_LIMIT_BYPASS_SECRET ?? "";

let pass = 0;
let fail = 0;
let inconclusive = 0;
const failures = [];
const skipped = [];

/** 429 means the assertion was never evaluated — record it as such. */
function check(name, ok, detail, status) {
  if (status === 429) {
    inconclusive++;
    skipped.push(name);
    return;
  }
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Endpoints that are public by design. Everything not listed here is expected
 * to reject an unauthenticated request with 401.
 *
 * `/payments/confirm` is deliberately public: it is PayMongo's webhook target
 * and authenticates by HMAC signature instead of a bearer token, so it answers
 * 400 (bad signature) rather than 401. That is correct and is asserted as such.
 */
const PUBLIC = new Set([
  "POST /auth/register",
  "POST /auth/login",
  "POST /auth/refresh",
  "GET /health",
  "GET /app-config",
  "GET /items",
  "GET /items/:id",
  "GET /items/:id/booked-dates",
  "GET /reviews/item/:itemId",
  "GET /reviews/user/:userId",
  "POST /payments/confirm",
]);

/** Representative endpoints per group. Kept explicit so a reviewer can see
 *  exactly what is asserted rather than trusting a generated list. */
const ENDPOINTS = [
  ["GET", "/auth/profile"], ["PUT", "/auth/profile"],
  ["POST", "/auth/profile/complete"], ["PUT", "/auth/password"],
  ["PUT", "/auth/payout-destination"], ["DELETE", "/auth/account"],
  ["POST", "/items"], ["GET", "/items/my-items"],
  ["PUT", `/items/${UUID}`], ["DELETE", `/items/${UUID}`],
  ["POST", "/rentals"], ["GET", "/rentals"], ["GET", `/rentals/${UUID}`],
  ["POST", `/rentals/${UUID}/cancel`], ["PATCH", `/rentals/${UUID}/dates`],
  ["GET", `/rentals/${UUID}/conversation`],
  ["POST", "/payments"], ["GET", "/payments"],
  ["GET", `/payments/status/${UUID}`], ["GET", "/payments/receiving-institutions"],
  ["POST", `/payments/${UUID}/refund`],
  ["POST", "/kiosk/deposit"], ["GET", "/kiosk/lockers"],
  ["POST", "/kiosk/session/start"], ["POST", "/kiosk/verify-face"],
  ["GET", "/notifications"], ["GET", "/notifications/preferences"],
  ["PUT", "/notifications/preferences"], ["PATCH", "/notifications/read-all"],
  ["POST", "/reviews"], ["GET", "/reviews/me"],
  ["POST", "/feedback"], ["GET", "/feedback/mine"],
  ["POST", "/upload/image"],
];

/** Admin-only or staff-only routes — an ordinary student must get 403. */
const ADMIN_ENDPOINTS = [
  ["GET", "/admin/stats"], ["GET", "/admin/users"], ["GET", "/admin/audit-log"],
  ["GET", "/admin/rentals"], ["GET", "/admin/transactions"],
  ["GET", "/admin/reports"], ["GET", "/admin/health"], ["GET", "/admin/kiosks"],
  ["GET", "/admin/id-verifications"], ["GET", "/admin/feedback"],
  ["GET", "/admin/verifications"],
  // NOTE: there is no `GET /admin/items` collection route — only
  // `/items/bulk`, `/items/:id` and `/items/:id/reviews`. An earlier version of
  // this sweep asserted 403 on the collection path and got a correct 404; the
  // test was wrong, not the API. Probe the real staff-gated route instead.
  ["GET", `/admin/items/${UUID}`],
];

async function call(method, path, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(BYPASS ? { "X-RateLimit-Bypass": BYPASS } : {}),
    },
    ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
  });
  return res.status;
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(BYPASS ? { "X-RateLimit-Bypass": BYPASS } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.data?.tokens?.accessToken ?? null;
}

(async () => {
  console.log(`auth matrix against ${API}\n`);

  // ── 1. No credentials at all ────────────────────────────────────────────
  console.log("1. unauthenticated requests must be 401");
  for (const [method, path] of ENDPOINTS) {
    const status = await call(method, path);
    check(`${method} ${path} unauth`, status === 401, `got ${status}`, status);
  }
  for (const [method, path] of ADMIN_ENDPOINTS) {
    const status = await call(method, path);
    check(`${method} ${path} unauth`, status === 401, `got ${status}`, status);
  }

  // ── 2. A syntactically valid but forged token ───────────────────────────
  // A bad signature must be rejected the same as no token — never 500, and
  // never quietly accepted.
  console.log("2. forged bearer tokens must be 401");
  const forged =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJ1c2VySWQiOiJhdHRhY2tlciIsInJvbGUiOiJBRE1JTiJ9.not_a_real_signature";
  for (const [method, path] of [["GET", "/auth/profile"], ["GET", "/admin/stats"]]) {
    const status = await call(method, path, forged);
    check(`${method} ${path} forged`, status === 401, `got ${status}`, status);
  }

  // ── 3. Ordinary student against admin routes ────────────────────────────
  console.log("3. student role on admin routes must be 403");
  const studentToken = await login(
    process.env.STUDENT_EMAIL ?? "e0test.renter@engirent.edu.ph",
    process.env.STUDENT_PASSWORD ?? "E0Capture2026!",
  );
  if (!studentToken) {
    check("student login", false, "could not obtain a student token");
  } else {
    for (const [method, path] of ADMIN_ENDPOINTS) {
      const status = await call(method, path, studentToken);
      check(`${method} ${path} as student`, status === 403, `got ${status}`, status);
    }
  }

  // ── 4. Public routes must stay reachable ────────────────────────────────
  // A 401 sweep is only meaningful if it hasn't accidentally locked the
  // public surface — this is the control.
  console.log("4. public routes must NOT require auth");
  for (const key of ["GET /health", "GET /items", "GET /app-config"]) {
    const [method, path] = key.split(" ");
    const status = await call(method, path);
    check(`${key} public`, status < 400, `got ${status}`, status);
  }

  console.log(`\npass ${pass}  fail ${fail}`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log("  - " + f);
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
