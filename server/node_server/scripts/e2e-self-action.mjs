/**
 * E1 — self-action rejection, the fifth of `API-TEST-PLAN.md`'s minimum cases.
 *
 * WHY THIS IS NOT THE OBVIOUS TEST.
 * D-3 predicted that "users can rent their own items" would repeat across
 * reviews, messaging and refunds. E0 found it does not: every one of those
 * paths **derives** the counterparty from the rental
 * (`isRenter ? ownerId : renterId`) rather than accepting it from the client.
 *
 * But that safety is **transitive**. Because self-rental is blocked at
 * creation, `renterId !== ownerId` holds for every rental in the system, which
 * is the only reason "review yourself" and "message yourself" are unreachable.
 * All three downstream guards therefore rest on a single line —
 * `rentalController.ts:40`.
 *
 * So asserting "I cannot review my own item" would pass **vacuously**: it is
 * structurally impossible, and the test would keep passing even if the guard
 * that makes it impossible were deleted. What is worth asserting instead is:
 *
 *   1. the load-bearing guard itself still rejects self-rental, and
 *   2. a non-participant cannot reach a rental's review, conversation or
 *      refund surfaces — the checks that would matter the moment (1) broke.
 *
 *   node scripts/e2e-self-action.mjs
 *
 * Env: API_BASE_URL, STUDENT_EMAIL/PASSWORD, ADMIN_EMAIL/PASSWORD,
 * RATE_LIMIT_BYPASS_SECRET. Creates one item to attempt self-rental against and
 * deletes it again, pass or fail.
 */
const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";
const BYPASS = process.env.RATE_LIMIT_BYPASS_SECRET ?? "";

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` (${detail})`}`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(BYPASS ? { "X-RateLimit-Bypass": BYPASS } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body is fine */
  }
  return { status: res.status, json };
}

async function login(email, password) {
  const r = await api("POST", "/auth/login", { body: { email, password } });
  return r.json?.data?.tokens?.accessToken ?? null;
}

(async () => {
  console.log(`self-action matrix against ${API}\n`);

  const student = await login(
    process.env.STUDENT_EMAIL ?? "e0test.renter@engirent.edu.ph",
    process.env.STUDENT_PASSWORD ?? "E0Capture2026!",
  );
  const admin = await login(
    process.env.ADMIN_EMAIL ?? "admin@engirent.edu.ph",
    process.env.ADMIN_PASSWORD ?? "EngiRent@2025!",
  );
  if (!student || !admin) {
    console.log("could not obtain tokens — aborting");
    process.exitCode = 1;
    return;
  }

  let itemId = null;
  try {
    // ── 1. The load-bearing guard ────────────────────────────────────────
    console.log("1. an owner cannot rent their own item");
    const created = await api("POST", "/items", {
      token: student,
      body: {
        title: "E2E self-action probe",
        description: "Created by e2e-self-action.mjs. Deleted at the end.",
        category: "ACADEMIC_TOOLS",
        condition: "GOOD",
        pricePerDay: 50,
        securityDeposit: 50,
        images: ["items/e2e-probe/listing-1.jpg"],
        campusLocation: "Test",
      },
    });
    itemId = created.json?.data?.item?.id ?? null;
    check("probe item created", Boolean(itemId), `status ${created.status}`);

    if (itemId) {
      const start = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const selfRent = await api("POST", "/rentals", {
        token: student,
        body: { itemId, startDate: start, endDate: end },
      });
      check(
        "self-rental rejected with 400",
        selfRent.status === 400,
        `got ${selfRent.status}`,
      );
      check(
        "rejection explains itself",
        /own item/i.test(JSON.stringify(selfRent.json ?? {})),
        `body: ${JSON.stringify(selfRent.json ?? {}).slice(0, 120)}`,
      );
    }

    // ── 2. The guards that matter if (1) ever breaks ─────────────────────
    // Admin is authenticated but is not a party to the student's rental, so
    // every rental-scoped surface must refuse them. These are the checks that
    // would carry the weight if the self-rental guard regressed.
    console.log("\n2. a non-participant cannot reach a rental's surfaces");
    const rentals = await api("GET", "/rentals", { token: student });
    const rentalId = rentals.json?.data?.rentals?.[0]?.id ?? null;
    check("student has a rental to probe", Boolean(rentalId));

    if (rentalId) {
      const convo = await api("GET", `/rentals/${rentalId}/conversation`, {
        token: admin,
      });
      check(
        "non-participant blocked from conversation",
        convo.status === 401 || convo.status === 403 || convo.status === 404,
        `got ${convo.status}`,
      );

      // The field is `body`, not `content`. An earlier version of this test
      // sent the wrong key, was rejected by `validate()` with a 400, and never
      // reached `assertParticipant` at all — so it asserted nothing about
      // authorization while appearing to. Send a VALID message, so the only
      // thing that can reject it is the participant check.
      const msg = await api("POST", `/rentals/${rentalId}/conversation/messages`, {
        token: admin,
        body: { body: "should never be delivered" },
      });
      check(
        "non-participant cannot post a VALID message",
        msg.status === 401 || msg.status === 403 || msg.status === 404,
        `got ${msg.status}${msg.status < 300 ? " — MESSAGE WAS DELIVERED" : ""}`,
      );

      const review = await api("POST", "/reviews", {
        token: admin,
        body: { rentalId, rating: 5, reviewType: "RENTER_TO_OWNER" },
      });
      check(
        "non-participant cannot review",
        review.status >= 400,
        `got ${review.status}`,
      );
    }

    // ── 3. Refund ownership ──────────────────────────────────────────────
    console.log("\n3. a user cannot refund a transaction that isn't theirs");
    const txns = await api("GET", "/payments", { token: student });
    const txnId = txns.json?.data?.transactions?.[0]?.id ?? null;
    if (txnId) {
      const refund = await api("POST", `/payments/${txnId}/refund`, {
        token: admin,
        body: {},
      });
      check(
        "foreign refund refused",
        refund.status >= 400,
        `got ${refund.status}`,
      );
    } else {
      console.log("  (no transaction available to probe — skipped)");
    }
  } finally {
    if (itemId) {
      const del = await api("DELETE", `/items/${itemId}`, { token: student });
      console.log(`\ncleanup: probe item deleted (status ${del.status})`);
    }
  }

  console.log(`\npass ${pass}  fail ${fail}`);
  if (failures.length) {
    console.log("failures:");
    for (const f of failures) console.log("  - " + f);
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
