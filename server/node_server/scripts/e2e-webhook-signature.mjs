/**
 * E1 — attack `POST /payments/confirm`, the money endpoint, on the RUNNING
 * deployment.
 *
 * This route is public by design: PayMongo calls it, so it authenticates by
 * HMAC signature instead of a bearer token. That makes the signature check the
 * only thing standing between an anonymous caller and "this transaction is
 * paid". `API-TEST-PLAN.md` lists it under "specifically risky"; the Jest
 * tests in `controllers/__tests__/paymentController.test.ts` cover the
 * function, and this covers the deployed server.
 *
 *   node scripts/e2e-webhook-signature.mjs
 *
 * Env: API_BASE_URL, ADMIN_EMAIL / ADMIN_PASSWORD (to read a real transaction
 *      and prove it did not move), RATE_LIMIT_BYPASS_SECRET (optional).
 *
 * The assertions
 * --------------
 *  1. A real-webhook-shaped body with **no** signature header → 400.
 *  2. …with a **malformed** signature header → 400, never a 500. (The header
 *     is attacker-controlled; `timingSafeEqual` throws on length mismatch, so
 *     this is a crash risk, not a theoretical one.)
 *  3. …with a **well-formed but wrong** HMAC → 400.
 *  4. The **manual/dev shape** — the one the mock checkout page sends — is
 *     refused in production. This is D-25 asserted rather than remembered: the
 *     gate is correct, and the consequence is that mock payments cannot
 *     complete on this deployment.
 *  5. **The control that makes the rest mean something:** a real PENDING
 *     transaction is named in every forged payload, and it is still PENDING
 *     afterwards. Without this, "the server said 400" proves the response, not
 *     the effect.
 */
import crypto from "node:crypto";

const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";
const BYPASS = process.env.RATE_LIMIT_BYPASS_SECRET ?? "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@engirent.edu.ph";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "EngiRent@2025!";

let pass = 0;
let fail = 0;
let inconclusive = 0;
const failures = [];
const skipped = [];

function check(name, ok, detail, status) {
  if (status === 429) {
    inconclusive++;
    skipped.push(`${name} (rate limited — assertion never evaluated)`);
    console.log(`  SKIP  ${name} — 429`);
    return;
  }
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(name, why) {
  inconclusive++;
  skipped.push(`${name} — ${why}`);
  console.log(`  SKIP  ${name} — ${why}`);
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

function headers(token, extra = {}) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(BYPASS ? { "X-RateLimit-Bypass": BYPASS } : {}),
    ...extra,
  };
}

async function jreq(path, { method = "GET", token, body, extraHeaders } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: headers(token, extraHeaders),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* reported through status */
  }
  return { status: res.status, json };
}

/** The exact shape PayMongo posts for a paid checkout session. */
function realWebhookBody(transactionId) {
  return {
    data: {
      type: "checkout_session.payment.paid",
      attributes: {
        reference_number: "E2E-FORGED",
        metadata: { transaction_id: transactionId },
        payments: [{ id: "pay_forged_by_e2e" }],
      },
    },
  };
}

(async () => {
  console.log(`webhook signature — attacking ${API}\n`);

  // ── Find a real PENDING transaction so the control is meaningful ──────────
  const login = await jreq("/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const adminToken = login.json?.data?.tokens?.accessToken ?? null;

  let target = null;
  if (adminToken) {
    const tx = await jreq("/admin/transactions?limit=50", { token: adminToken });
    const list = tx.json?.data?.transactions ?? tx.json?.data ?? [];
    target = (Array.isArray(list) ? list : []).find((t) => t.status === "PENDING") ?? null;
  }

  // A transaction id that exists is best; a random one still exercises the
  // gate, it just cannot prove "nothing moved".
  const targetId = target?.id ?? "00000000-0000-4000-8000-000000000000";
  console.log(
    target
      ? `  target: real PENDING transaction ${targetId}`
      : "  target: no PENDING transaction found — the state control will be SKIPPED",
  );

  // ── 1-3. Forged real-webhook payloads ─────────────────────────────────────
  section("1. real-webhook shape, no signature header");
  const unsigned = await jreq("/payments/confirm", {
    method: "POST",
    body: realWebhookBody(targetId),
  });
  check(
    "rejected with 400",
    unsigned.status === 400,
    `got ${unsigned.status} ${JSON.stringify(unsigned.json)?.slice(0, 160)}`,
    unsigned.status,
  );
  check(
    "and names the signature as the reason",
    /signature/i.test(JSON.stringify(unsigned.json ?? "")),
    JSON.stringify(unsigned.json)?.slice(0, 160),
    unsigned.status,
  );

  section("2. real-webhook shape, malformed signature header");
  for (const header of [
    "garbage",
    "t=,te=",
    "t=1700000000,te=zz",
    "t=1700000000",
    `t=1700000000,te=${"f".repeat(200)}`,
  ]) {
    const res = await jreq("/payments/confirm", {
      method: "POST",
      body: realWebhookBody(targetId),
      extraHeaders: { "paymongo-signature": header },
    });
    check(
      `"${header.slice(0, 24)}${header.length > 24 ? "…" : ""}" → 400, not 500`,
      res.status === 400,
      `got ${res.status} ${JSON.stringify(res.json)?.slice(0, 120)}`,
      res.status,
    );
  }

  section("3. real-webhook shape, well-formed but wrong HMAC");
  const body = realWebhookBody(targetId);
  const ts = Math.floor(Date.now() / 1000);
  const wrongHmac = crypto
    .createHmac("sha256", "definitely-not-the-webhook-secret")
    .update(`${ts}.${JSON.stringify(body)}`)
    .digest("hex");
  const forged = await jreq("/payments/confirm", {
    method: "POST",
    body,
    extraHeaders: { "paymongo-signature": `t=${ts},te=${wrongHmac}` },
  });
  check(
    "rejected with 400",
    forged.status === 400,
    `got ${forged.status} ${JSON.stringify(forged.json)?.slice(0, 160)}`,
    forged.status,
  );

  // ── 4. The manual/dev shape (D-25) ────────────────────────────────────────
  section("4. manual confirm shape — the mock checkout page's request");
  const manual = await jreq("/payments/confirm", {
    method: "POST",
    body: { transactionId: targetId, paymentId: "manual-e2e", referenceNo: "E2E" },
  });
  check(
    "refused (no bearer token needed to reach the gate — it is not a 401)",
    manual.status === 400,
    `got ${manual.status} ${JSON.stringify(manual.json)?.slice(0, 160)}`,
    manual.status,
  );
  const manualSaysSignature = /signature is required/i.test(
    JSON.stringify(manual.json ?? ""),
  );
  check(
    "and the reason is the production signature requirement (D-25 confirmed live)",
    manualSaysSignature,
    JSON.stringify(manual.json)?.slice(0, 200),
    manual.status,
  );
  if (manualSaysSignature) {
    console.log(
      "  NOTE  D-25 still reproduces: the mock-payment fallback cannot complete\n" +
        "        a payment on this deployment. The gate is correct; the mock page\n" +
        "        needs to route through the admin decide-payment path instead.",
    );
  }

  // ── 5. Nothing moved ──────────────────────────────────────────────────────
  section("5. control — the named transaction did not change");
  if (!adminToken) {
    skip("state control", "could not log in as admin to re-read the transaction");
  } else if (!target) {
    skip("state control", "no PENDING transaction existed to name");
  } else {
    const after = await jreq("/admin/transactions?limit=50", { token: adminToken });
    const list = after.json?.data?.transactions ?? after.json?.data ?? [];
    const now = (Array.isArray(list) ? list : []).find((t) => t.id === targetId);
    check(
      "still PENDING after every forged confirm",
      now?.status === "PENDING",
      `status is now ${now?.status ?? "missing"}`,
      after.status,
    );
  }

  console.log(`\npass ${pass}  fail ${fail}  inconclusive ${inconclusive}`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log("  - " + f);
  }
  if (skipped.length) {
    console.log("\nnot evaluated:");
    for (const s of skipped) console.log("  - " + s);
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
