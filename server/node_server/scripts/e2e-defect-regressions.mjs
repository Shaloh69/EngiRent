/**
 * E1 — regression tests for the defects E0 fixed, run against the RUNNING
 * deployment.
 *
 *   node scripts/e2e-defect-regressions.mjs
 *
 * Env: API_BASE_URL, STUDENT_EMAIL / STUDENT_PASSWORD,
 *      RATE_LIMIT_BYPASS_SECRET (optional).
 *
 * Each defect below was fixed and verified once, by hand, on a screen. That
 * proves it was fixed; it does not stop it coming back. These are the
 * assertions that would have caught each one, written where the bug actually
 * lived rather than where it was convenient to test:
 *
 *  · **D-1** — the *login* response must carry `verificationStatus` /
 *    `verificationReason` / `verificationNote`. The client-side parser fix had
 *    six green unit tests while the bug was **still on screen**, because the
 *    parser was never the whole cause: `login` hand-builds its user object and
 *    was omitting all three fields. So the test that matters is on the
 *    response shape, not the parser.
 *  · **D-15** — a malformed JSON body must produce a clean 400, not a 500,
 *    on *every* JSON endpoint. This is the "clean 400" column of all 93
 *    endpoint rows, so it is swept across a representative set rather than
 *    asserted once.
 *  · **D-17** — item media must come back rebuilt against the **currently
 *    configured** public host and must actually load. The failure mode was
 *    absolute URLs with a dead Cloudflare hostname frozen into the row, which
 *    no config change could fix and which silently disabled ML verification
 *    (D-18). Note the rewrite targets `API_PUBLIC_URL`, not the host the
 *    request arrived on — so over localhost the two differ *correctly*, and
 *    the first version of this test asserted equality and failed the API for
 *    it. Checking the route before recording a defect applies to one's own
 *    tests too.
 */
const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";
const ORIGIN = API.replace(/\/api\/v\d+\/?$/, "");
const BYPASS = process.env.RATE_LIMIT_BYPASS_SECRET ?? "";
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "e0test.renter@engirent.edu.ph";
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD ?? "E0Capture2026!";

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

/** Sends a deliberately broken body — a raw string, not JSON.stringify'd — so
 *  body-parser throws before any controller runs. */
async function rawPost(path, token, rawBody) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: headers(token),
    body: rawBody,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* a non-JSON error body is itself part of what is asserted */
  }
  return { status: res.status, json };
}

(async () => {
  console.log(`defect regressions against ${API}\n`);

  // ── D-1 ────────────────────────────────────────────────────────────────────
  section("D-1 — the login response carries verification state");

  const loginRes = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: headers(null),
    body: JSON.stringify({ email: STUDENT_EMAIL, password: STUDENT_PASSWORD }),
  });
  const loginJson = await loginRes.json().catch(() => null);
  const user = loginJson?.data?.user ?? null;
  const token = loginJson?.data?.tokens?.accessToken ?? null;

  if (!user) {
    check("student login", false, `status ${loginRes.status}`, loginRes.status);
  } else {
    // Present as a KEY, even when the value is null — the bug was the field
    // being absent, which the client then defaulted to "UNSUBMITTED".
    for (const field of [
      "verificationStatus",
      "verificationReason",
      "verificationNote",
    ]) {
      check(
        `login response has \`${field}\``,
        Object.prototype.hasOwnProperty.call(user, field),
        `keys: ${Object.keys(user).join(", ")}`,
        loginRes.status,
      );
    }
    check(
      "verificationStatus is a real status, not a client-side default",
      ["UNSUBMITTED", "PENDING", "APPROVED", "REJECTED"].includes(
        user.verificationStatus,
      ),
      `got ${JSON.stringify(user.verificationStatus)}`,
      loginRes.status,
    );

    // The other half of D-1: login and getProfile must agree. They are built
    // by different code paths (hand-rolled object vs PROFILE_SELECT), which is
    // exactly how they drifted apart in the first place.
    const profileRes = await fetch(`${API}/auth/profile`, { headers: headers(token) });
    const profileJson = await profileRes.json().catch(() => null);
    const profile = profileJson?.data?.user ?? profileJson?.data ?? null;
    check(
      "login and GET /auth/profile report the same verificationStatus",
      profile?.verificationStatus === user.verificationStatus,
      `login=${user.verificationStatus} profile=${profile?.verificationStatus}`,
      profileRes.status,
    );
  }

  // ── D-15 ───────────────────────────────────────────────────────────────────
  section("D-15 — malformed JSON is a clean 400 on every JSON endpoint");

  const malformedTargets = [
    ["/auth/login", null],
    ["/auth/register", null],
    ["/payments", token],
    ["/rentals", token],
    ["/reviews", token],
    ["/feedback", token],
    ["/kiosk/session/start", token],
  ];
  for (const [path, tok] of malformedTargets) {
    const res = await rawPost(path, tok, '{"email": ');
    check(
      `POST ${path} → 400`,
      res.status === 400,
      `got ${res.status} ${JSON.stringify(res.json)?.slice(0, 120)}`,
      res.status,
    );
    check(
      `POST ${path} → the message blames the body, not the server`,
      /could not be parsed|malformed/i.test(JSON.stringify(res.json ?? "")),
      JSON.stringify(res.json)?.slice(0, 120),
      res.status,
    );
  }

  // A body-parser rejection must not be confused with an app-level SyntaxError:
  // valid JSON that is simply wrong for the route must still reach validation.
  const wrongShape = await rawPost("/auth/login", null, JSON.stringify({ nope: 1 }));
  check(
    "valid JSON with the wrong fields still reaches validation (400, not the parser message)",
    wrongShape.status === 400 &&
      !/could not be parsed/i.test(JSON.stringify(wrongShape.json ?? "")),
    `got ${wrongShape.status} ${JSON.stringify(wrongShape.json)?.slice(0, 140)}`,
    wrongShape.status,
  );

  // ── D-17 ───────────────────────────────────────────────────────────────────
  section("D-17 — item media resolves against the current host and loads");

  const itemsRes = await fetch(`${API}/items?limit=10`, { headers: headers(null) });
  const itemsJson = await itemsRes.json().catch(() => null);
  const items = itemsJson?.data?.items ?? itemsJson?.data ?? [];
  const withImages = (Array.isArray(items) ? items : []).filter(
    (i) => Array.isArray(i.images) && i.images.length > 0,
  );

  if (withImages.length === 0) {
    skip("item media", "no item in the catalogue has an image to check");
  } else {
    const urls = withImages.flatMap((i) => i.images).slice(0, 5);
    const hosts = [...new Set(urls.map((u) => new URL(String(u)).origin))];

    // Every row is rewritten from the same relative path against the same
    // configured host, so per-row drift — one item on a dead hostname, another
    // on the live one — is exactly the D-17 symptom.
    check(
      "all item media URLs share one host (no per-row baked-in hostname)",
      hosts.length === 1,
      `hosts: ${hosts.join(", ")}`,
      itemsRes.status,
    );

    // The rewrite targets `API_PUBLIC_URL` — the address a phone off the
    // tailnet can actually reach — NOT the host this request arrived on. So
    // this assertion only means something when the suite is itself talking to
    // the public host; over localhost the two are correctly different, and
    // asserting equality there was a bug in this test, not in the API.
    if (/^https?:\/\/localhost|127\.0\.0\.1/.test(ORIGIN)) {
      skip(
        "media host matches the API host",
        `called over ${ORIGIN}; media is rewritten to API_PUBLIC_URL (${hosts[0]}) ` +
          "on purpose, so equality here would be wrong",
      );
    } else {
      check(
        "media host matches the host this request came in on",
        hosts.length === 1 && hosts[0] === ORIGIN,
        `origin ${ORIGIN}; media host ${hosts.join(", ")}`,
        itemsRes.status,
      );
    }

    // The URL being well-formed is not the point — D-18 was caused by URLs that
    // looked fine and 404'd, which silently skipped ML verification entirely.
    const head = await fetch(urls[0], { headers: BYPASS ? { "X-RateLimit-Bypass": BYPASS } : {} });
    check(
      "the first image actually loads (200)",
      head.status === 200,
      `got ${head.status} for ${urls[0]}`,
      head.status,
    );
    check(
      "…and is served as an image",
      String(head.headers.get("content-type") ?? "").startsWith("image/"),
      `content-type ${head.headers.get("content-type")}`,
      head.status,
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
