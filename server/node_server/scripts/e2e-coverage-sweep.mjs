#!/usr/bin/env node
/**
 * e2e-coverage-sweep.mjs — closes the safe happy-path gaps in Register 3.
 *
 * WHY THIS EXISTS
 * Register 3 was filled in 2026-09-06 by statically extracting the paths every
 * suite actually calls. That put happy-path coverage at 55/93. Most of the
 * remaining 38 are not hard — they are ordinary reads and account-lifecycle
 * calls that no existing suite happened to touch, because each suite was
 * written around a feature rather than around the route table.
 *
 * DELIBERATELY NOT SWEPT — read before adding anything here:
 *   · POST /admin/kiosks/:kioskId/command, the two locker-release routes, and
 *     PUT /admin/kiosks/:kioskId/config drive REAL RELAYS, SOLENOIDS and
 *     LINEAR ACTUATORS in a corridor. A sweep must never fire them. They are
 *     covered by hand, with the hardware watched.
 *   · POST /kiosk/upload needs KIOSK_SHARED_SECRET, which should not leave the
 *     server.
 *   · PATCH /admin/users/:id, POST /admin/rentals/:id/complete,
 *     POST /admin/transactions/:id/refund, PATCH /admin/verifications/:id all
 *     mutate live rows and need fixtures to be honest, which means Prisma —
 *     so they belong in a server-run suite, not this one.
 *
 * ASSERT SHAPE, NOT JUST STATUS. Every check below asserts something about the
 * body, so a route replaced by a 200-returning stub still fails. A sweep that
 * only counts 200s proves the router is mounted and nothing else.
 *
 * IT REUSES ONE PROBE IDENTITY, ON PURPOSE. `DELETE /auth/account` is a SOFT
 * delete — it sets `isActive = false` and keeps the row (its own copy says
 * "deactivated", and `Rental`/`Review` do not cascade from `User`, so a hard
 * delete is not on offer). `GET /admin/stats`'s `totalUsers` counts
 * `role: STUDENT` WITHOUT filtering on `isActive`, so every fresh throwaway
 * account this suite creates would permanently increment the admin dashboard's
 * headline user count. A test suite that silently inflates a reported business
 * metric is not acceptable, so this one registers a FIXED address once and logs
 * in on every run afterwards — litter is bounded at exactly one row, forever.
 * The first run covers `POST /auth/register`; every later run covers its
 * duplicate-rejection path instead, which is arguably the better assertion.
 *
 * SKIP IS NOT PASS. Where a precondition is genuinely absent (no notification
 * exists yet for a brand-new account), the row reports SKIP with its reason and
 * is excluded from the pass count. Silence dressed as success is the failure
 * mode this whole phase keeps rediscovering.
 *
 * Pure HTTP — no @prisma/client import — so unlike nine of its siblings this
 * one runs from a laptop against the tunnel as well as on the server.
 *
 *   API_BASE_URL=<api>/api/v1 node scripts/e2e-coverage-sweep.mjs
 */

const API = process.env.API_BASE_URL || "http://localhost:5000/api/v1";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@engirent.edu.ph";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "EngiRent@2025!";

// Shared with every other suite: unset means the header is absent and normal
// limits apply. Never an IP allowlist — the limiter keys on CF-Connecting-IP,
// which is client-supplied off the Cloudflare path and therefore spoofable.
const BYPASS = process.env.RATE_LIMIT_BYPASS_SECRET
  ? { "X-RateLimit-Bypass": process.env.RATE_LIMIT_BYPASS_SECRET }
  : {};

let passed = 0;
let failed = 0;
const skipped = [];

function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(name, why) {
  skipped.push(`${name} — ${why}`);
  console.log(`  SKIP  ${name} — ${why}`);
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

async function req(path, { method = "GET", token, body, raw } = {}) {
  const headers = { ...BYPASS };
  if (!raw) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (SSE, media) — status still meaningful */
  }
  return { status: res.status, json };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

async function main() {
  console.log(`Coverage sweep against ${API}`);
  if (!Object.keys(BYPASS).length)
    console.log("(no rate-limit bypass secret set — this suite is small enough to run without one)");

  // ── One fixed probe identity — see the header for why this is not a fresh
  //    account per run. The password is rotated back at the end so the next
  //    run can log in with the same value. ─────────────────────────────────
  const email = "e2e-sweep-probe@students.uclm.edu.ph";
  const password = "SweepTest@2026!";
  const tempPassword = "SweepTest@2026b!";
  let token = null;
  let refreshToken = null;

  section("account lifecycle");

  {
    const r = await req("/auth/register", {
      method: "POST",
      body: {
        email,
        password,
        studentId: "SW00000001",
        firstName: "Sweep",
        lastName: "Probe",
        // The field is `phoneNumber`, NOT `phone`. Implemented.md §3.1 says
        // "phone" and is wrong — authRoutes.ts:37 is authoritative. Fifth time
        // this phase that a doc's field name has cost a red run.
        phoneNumber: "+639170000000",
      },
    });
    if (r.status === 201 || r.status === 200) {
      ok("POST /auth/register issues a token (first run — probe did not exist)", true);
      token = r.json?.data?.tokens?.accessToken ?? null;
      refreshToken = r.json?.data?.tokens?.refreshToken ?? null;
    } else {
      // Expected on every run after the first. Assert the duplicate is
      // REJECTED rather than quietly creating a second row.
      ok(
        "POST /auth/register refuses a duplicate address",
        r.status === 400 || r.status === 409,
        `status ${r.status}`,
      );
      // A previous run may have died between the password change and the
      // rotate-back, so try both values before giving up.
      for (const pw of [password, tempPassword]) {
        const li = await req("/auth/login", { method: "POST", body: { email, password: pw } });
        if (li.status === 200) {
          token = li.json?.data?.tokens?.accessToken ?? null;
          refreshToken = li.json?.data?.tokens?.refreshToken ?? null;
          break;
        }
      }
    }
    if (!token) {
      console.log("\nCannot continue without a student token.");
      console.log(JSON.stringify(r.json)?.slice(0, 300));
      finish();
      return;
    }
  }

  // POST /auth/refresh — assert a NEW access token comes back, not just a 200.
  if (refreshToken) {
    const r = await req("/auth/refresh", { method: "POST", body: { refreshToken } });
    const fresh = r.json?.data?.accessToken ?? r.json?.data?.token;
    ok(
      "POST /auth/refresh returns a usable access token",
      r.status === 200 && typeof fresh === "string" && fresh.length > 20,
      `status ${r.status}`,
    );
    if (typeof fresh === "string" && fresh.length > 20) token = fresh;
  } else {
    skip("POST /auth/refresh", "register did not return a refreshToken");
  }

  // PUT /auth/profile — assert the change is actually reflected back.
  {
    const r = await req("/auth/profile", {
      method: "PUT",
      token,
      body: { firstName: "Swept" },
    });
    const after = await req("/auth/profile", { token });
    ok(
      "PUT /auth/profile persists the change",
      r.status === 200 && after.json?.data?.user?.firstName === "Swept",
      `put ${r.status}, name now ${after.json?.data?.user?.firstName}`,
    );
  }

  // PUT /auth/payout-destination
  {
    const r = await req("/auth/payout-destination", {
      method: "PUT",
      token,
      // The real enum is instapay|pesonet, and bic + institutionName are
      // REQUIRED (authRoutes.ts:96-104). The whole form is shaped around
      // PayMongo's Disbursement rails — see the note in PROGRESS.md, because
      // under the manual-payments ruling that shape is now wrong.
      body: {
        provider: "instapay",
        bic: "BOPIPHMM",
        institutionName: "BPI",
        accountName: "Sweep Probe",
        accountNumber: "1234567890",
      },
    });
    const after = await req("/auth/profile", { token });
    ok(
      "PUT /auth/payout-destination sets payoutConfigured",
      r.status === 200 && after.json?.data?.user?.payoutConfigured === true,
      `put ${r.status}, payoutConfigured ${after.json?.data?.user?.payoutConfigured}`,
    );
  }

  section("read-only student surface");

  for (const [name, path, check] of [
    ["GET /rentals", "/rentals", (j) => Array.isArray(j?.data?.rentals ?? j?.data)],
    ["GET /payments", "/payments", (j) => Array.isArray(j?.data?.transactions ?? j?.data)],
    ["GET /reviews/me", "/reviews/me", (j) => j?.success === true],
    ["GET /kiosk/lockers", "/kiosk/lockers", (j) => j?.success === true],
    ["GET /notifications", "/notifications", (j) => j?.success === true],
  ]) {
    const r = await req(path, { token });
    ok(`${name} returns its documented shape`, r.status === 200 && check(r.json), `status ${r.status}`);
  }

  section("notifications lifecycle");

  {
    const list = await req("/notifications", { token });
    const items = list.json?.data?.notifications ?? list.json?.data ?? [];
    const first = Array.isArray(items) ? items[0] : null;
    if (first?.id) {
      const r = await req(`/notifications/${first.id}/read`, { method: "PATCH", token });
      ok("PATCH /notifications/:id/read", r.status === 200, `status ${r.status}`);
      const d = await req(`/notifications/${first.id}`, { method: "DELETE", token });
      ok("DELETE /notifications/:id", d.status === 200, `status ${d.status}`);
    } else {
      skip("PATCH /notifications/:id/read", "a brand-new account has no notifications");
      skip("DELETE /notifications/:id", "a brand-new account has no notifications");
    }
    const all = await req("/notifications/read-all", { method: "PATCH", token });
    ok("PATCH /notifications/read-all", all.status === 200, `status ${all.status}`);
  }

  section("retired endpoints — must be 410 Gone, not 400");

  // Regression on the 2026-09-06 ruling. These returned 400 before it, which a
  // caller cannot tell apart from "you sent a malformed body". If either ever
  // reverts to 400, that is the thing this asserts.
  // MUST send a well-formed UUID. Both routes run
  // `validate([body("rentalId").isUUID()])` BEFORE the retired handler, so a
  // junk id returns a validation 400 and the GoneError is never reached — the
  // first version of this test asserted exactly that and blamed the API.
  // (That ordering is itself a small honesty defect: a dead endpoint tells you
  // to fix your body. Logged as D-31.)
  const UUID0 = "00000000-0000-4000-8000-000000000000";
  const RETIRED_BODIES = {
    // Each route's validators differ — /return also demands lockerId and an
    // images array (kioskRoutes.ts:49-53). Sending only rentalId gets a
    // validation 400 that looks exactly like a missing 410.
    "/kiosk/claim": { rentalId: UUID0 },
    "/kiosk/return": { rentalId: UUID0, lockerId: UUID0, images: [] },
  };
  for (const [path, probeBody] of Object.entries(RETIRED_BODIES)) {
    const r = await req(path, { method: "POST", token, body: probeBody });
    // Distinguish the two ways this can be 400, because they need opposite
    // responses: if the retirement MESSAGE comes back with a 400, the handler
    // ran and only the status class is old — i.e. the GoneError change is in
    // the repo but not on this deployment. If the message is a validation
    // complaint, the probe never reached the handler and the TEST is wrong.
    const body = String(r.json?.error ?? r.json?.message ?? "");
    const reachedHandler = body.includes("no longer works");
    ok(
      `POST ${path} → 410 Gone`,
      r.status === 410,
      reachedHandler
        ? `got ${r.status} with the retirement message — handler ran, so GoneError is NOT deployed here (repo has it, server's errors.ts does not)`
        : `got ${r.status} and never reached the handler — check the probe, not the API: ${body.slice(0, 90)}`,
    );
  }

  section("admin read surface");

  const admin = await req("/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  // Same shape as register: data.tokens.accessToken. Reading data.accessToken
  // returns undefined against a 200, which reads as "login failed" and is not.
  const adminToken = admin.json?.data?.tokens?.accessToken ?? null;

  if (!adminToken) {
    skip("all admin rows", `admin login failed (${admin.status}) — set ADMIN_EMAIL / ADMIN_PASSWORD`);
  } else {
    for (const [name, path, check] of [
      ["GET /admin/stats", "/admin/stats", (j) => isNum(j?.data?.totalUsers ?? j?.data?.stats?.totalUsers)],
      ["GET /admin/reports", "/admin/reports", (j) => j?.success === true && j?.data != null],
      ["GET /admin/health", "/admin/health", (j) => j?.success === true && j?.data != null],
      ["GET /admin/verifications", "/admin/verifications", (j) => j?.success === true],
    ]) {
      const r = await req(path, { token: adminToken });
      ok(`${name} returns real data`, r.status === 200 && check(r.json), `status ${r.status}`);
    }

    // Kiosk CONFIG READ only. The PUT and the command endpoint move hardware
    // and are deliberately absent from this sweep — see the header.
    const kiosks = await req("/admin/kiosks", { token: adminToken });
    const kioskId =
      kiosks.json?.data?.kiosks?.[0]?.kioskId ??
      kiosks.json?.data?.[0]?.kioskId ??
      null;
    if (kioskId) {
      const r = await req(`/admin/kiosks/${kioskId}/config`, { token: adminToken });
      ok(`GET /admin/kiosks/:kioskId/config`, r.status === 200 && r.json?.success === true, `status ${r.status}`);
    } else {
      skip("GET /admin/kiosks/:kioskId/config", "no kiosk registered to read a config from");
    }
  }

  section("known-blocked — asserted as blocked, never counted as a pass");

  {
    // PayMongo Disbursements is not enabled on the account, so this route 500s
    // on a 404 from transfers/receiving_institutions. Under the 2026-09-06
    // manual-payments ruling it is moot — but it must not silently start
    // "passing" either. Assert the known failure, and say so loudly if it heals.
    const r = await req("/payments/receiving-institutions", { token });
    if (r.status === 200) {
      console.log("  NOTE  GET /payments/receiving-institutions now returns 200 — Disbursements may have been enabled. Update D-21 and this suite.");
      ok("GET /payments/receiving-institutions (unexpectedly healthy)", true);
    } else {
      skip(
        "GET /payments/receiving-institutions",
        `BLOCKED — status ${r.status}; Disbursements not enabled, moot under the manual-payments ruling`,
      );
    }
  }

  section("password rotation, logout, and the soft-delete round trip");

  {
    const r = await req("/auth/password", {
      method: "PUT",
      token,
      body: { currentPassword: password, newPassword: tempPassword },
    });
    ok("PUT /auth/password accepts a valid change", r.status === 200, `status ${r.status}`);

    // Re-login proves the change actually took, rather than trusting the 200.
    const relog = await req("/auth/login", { method: "POST", body: { email, password: tempPassword } });
    const newToken = relog.json?.data?.tokens?.accessToken ?? token;
    ok("the new password actually works", relog.status === 200, `re-login status ${relog.status}`);

    const lo = await req("/auth/logout", { method: "POST", token: newToken });
    ok("POST /auth/logout", lo.status === 200, `status ${lo.status}`);

    // Rotate back FIRST, so the probe is reusable even if the rest fails.
    const back = await req("/auth/password", {
      method: "PUT",
      token: newToken,
      body: { currentPassword: tempPassword, newPassword: password },
    });
    ok("the probe password is rotated back for the next run", back.status === 200, `status ${back.status}`);

    const relog2 = await req("/auth/login", { method: "POST", body: { email, password } });
    const finalToken = relog2.json?.data?.tokens?.accessToken ?? newToken;

    // DELETE /auth/account is a SOFT delete. Assert what it actually does
    // rather than what its message implies: the row survives with
    // isActive=false, login stops working, and `totalUsers` still counts it.
    const del = await req("/auth/account", {
      method: "DELETE",
      token: finalToken,
      body: { password },
    });
    ok("DELETE /auth/account succeeds", del.status === 200, `status ${del.status}`);
    ok(
      "DELETE /auth/account describes itself as a DEACTIVATION, not a purge",
      /deactivat/i.test(String(del.json?.message ?? "")),
      `message was: ${String(del.json?.message ?? "").slice(0, 80)}`,
    );

    const gone = await req("/auth/login", { method: "POST", body: { email, password } });
    ok("the deleted account can no longer log in", gone.status === 401 || gone.status === 400, `status ${gone.status}`);

    // Reactivate so the probe is usable next run — and this is the only
    // coverage `PATCH /admin/users/:id` has, so it is a real assertion, not
    // just housekeeping.
    if (adminToken) {
      const list = await req(`/admin/users?limit=100`, { token: adminToken });
      const rows = list.json?.data?.users ?? list.json?.data ?? [];
      const probe = (Array.isArray(rows) ? rows : []).find((u) => u.email === email);
      if (probe?.id) {
        const pat = await req(`/admin/users/${probe.id}`, {
          method: "PATCH",
          token: adminToken,
          body: { isActive: true },
        });
        const backIn = await req("/auth/login", { method: "POST", body: { email, password } });
        ok(
          "PATCH /admin/users/:id reactivates the probe (and login works again)",
          pat.status === 200 && backIn.status === 200,
          `patch ${pat.status}, login ${backIn.status}`,
        );
      } else {
        skip("PATCH /admin/users/:id", "could not find the probe row to reactivate");
      }
    } else {
      skip("PATCH /admin/users/:id", "no admin token — probe is left deactivated, next run will report it");
    }
  }

  finish();
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (skipped.length) {
    console.log(`${skipped.length} skipped (NOT counted as passes):`);
    for (const s of skipped) console.log(`  · ${s}`);
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\nSuite crashed:", e);
  process.exitCode = 1;
});
