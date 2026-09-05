/**
 * E1 — attack the kiosk trust boundary on the RUNNING deployment.
 *
 * `API-TEST-PLAN.md` lists this first under "specifically risky", and the
 * instruction is explicit: **test it by attacking it**. The unit tests
 * (`kioskSessionStore.test.ts`, `kioskVerifyFace.test.ts`) prove the logic in
 * isolation; this proves the deployed server actually behaves that way, over
 * real HTTP and a real socket.io connection.
 *
 *   node scripts/e2e-kiosk-trust.mjs
 *
 * Env: API_BASE_URL (…/api/v1), STUDENT_EMAIL / STUDENT_PASSWORD,
 *      RATE_LIMIT_BYPASS_SECRET (optional — this suite is small enough to fit
 *      inside one rate-limit window without it),
 *      KIOSK_SHARED_SECRET (optional — see "positive control" below).
 *
 * What is attacked
 * ----------------
 *  1. `POST /kiosk/verify-face` with no live kiosk session → rejected.
 *  2. …with a client-supplied `kioskId`/`token`/`userId` in the body → still
 *     rejected. Those fields cannot conjure a session into existence; the
 *     kiosk id used downstream comes only from the session record.
 *  3. `POST /kiosk/session/start` — the app-facing half of the handshake —
 *     must NOT itself open a session. It forwards a token to the Pi for the
 *     Pi to validate; only the Pi's own `kiosk:flow_start` opens one. So a
 *     verify-face immediately after a session/start with a forged token must
 *     still be refused.
 *  4. A socket that is not the kiosk cannot open a session: `kiosk:flow_start`
 *     from an anonymous socket and from an authenticated *student* socket are
 *     both ignored.
 *
 * Why the silence test is not vacuous
 * -----------------------------------
 * "The server didn't answer" is worthless on its own — a broken test harness
 * looks identical. Two controls run alongside it:
 *
 *  · **Round-trip control (no secret needed).** The same authenticated student
 *    socket emits `app:kiosk_scan` with missing fields and MUST receive
 *    `kiosk:scan_error` back. That proves the connection, the auth and the
 *    emit/receive path all work — so the silence on `kiosk:flow_start` is the
 *    kiosk gate, not a dead socket.
 *  · **Positive control (needs KIOSK_SHARED_SECRET).** A socket authenticated
 *    as the kiosk emits the same `kiosk:flow_start` for an unknown rental and
 *    MUST receive `kiosk:command {action:"flow_error"}`. That isolates the
 *    gate as the only difference. Without the secret this is reported SKIPPED,
 *    never as a pass.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";
const ORIGIN = API.replace(/\/api\/v\d+\/?$/, "");
const BYPASS = process.env.RATE_LIMIT_BYPASS_SECRET ?? "";
const KIOSK_SECRET = process.env.KIOSK_SHARED_SECRET ?? "";
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "e0test.renter@engirent.edu.ph";
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD ?? "E0Capture2026!";

/** A rental id that is a valid UUID but belongs to nobody — the session check
 *  runs before the rental is ever read, so no real rental is needed and none
 *  is touched. */
const ORPHAN_RENTAL = "00000000-0000-4000-8000-000000000000";

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
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(BYPASS ? { "X-RateLimit-Bypass": BYPASS } : {}),
    ...extra,
  };
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: headers(null, { "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.data?.tokens?.accessToken ?? null;
}

/** The app's real request shape: multipart, one image field, one rentalId. */
async function verifyFace(token, extraFields = {}) {
  const form = new FormData();
  // Deliberately not a real face — every assertion here must be reached and
  // refused long before anything is compared.
  form.append(
    "file",
    new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01])], {
      type: "image/jpeg",
    }),
    "face.jpg",
  );
  form.append("rentalId", ORPHAN_RENTAL);
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);

  const res = await fetch(`${API}/kiosk/verify-face`, {
    method: "POST",
    headers: headers(token),
    body: form,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body is itself a finding — reported via status */
  }
  return { status: res.status, json };
}

/** Minimal socket.io client, borrowed from the kiosk UI's own node_modules so
 *  this script adds no dependency to the API package. */
function loadSocketIo() {
  for (const spec of [
    "socket.io-client",
    "../../kiosk/kiosk_ui_react/node_modules/socket.io-client",
  ]) {
    try {
      return require(spec).io;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

/** Connect, emit, and resolve with the first matching reply — or null after
 *  `waitMs` of silence. Silence is the expected result for a blocked event. */
function probeSocket(io, { auth, emit, listenFor, waitMs = 4000 }) {
  return new Promise((resolve) => {
    const socket = io(ORIGIN, {
      auth,
      transports: ["websocket", "polling"],
      reconnection: false,
      timeout: 8000,
    });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => done({ connected: socket.connected, reply: null }), waitMs);

    socket.on("connect_error", (err) => done({ connected: false, error: String(err?.message ?? err), reply: null }));
    for (const event of listenFor) {
      socket.on(event, (payload) => done({ connected: true, reply: { event, payload } }));
    }
    socket.on("connect", () => {
      for (const [event, payload] of emit) socket.emit(event, payload);
    });
  });
}

(async () => {
  console.log(`kiosk trust boundary — attacking ${API}\n`);

  const studentToken = await login(STUDENT_EMAIL, STUDENT_PASSWORD);
  if (!studentToken) {
    console.log(
      `FATAL: could not log in as ${STUDENT_EMAIL}. Nothing below can be asserted.`,
    );
    process.exitCode = 1;
    return;
  }

  // ── 1. verify-face without a session ──────────────────────────────────────
  section("1. POST /kiosk/verify-face with no live kiosk session");

  const noSession = await verifyFace(studentToken);
  check(
    "refused outright",
    noSession.status === 400 || noSession.status === 403,
    `got ${noSession.status} ${JSON.stringify(noSession.json)?.slice(0, 160)}`,
    noSession.status,
  );
  check(
    "and says why — rescan the kiosk QR",
    /kiosk session|scan the kiosk/i.test(JSON.stringify(noSession.json ?? "")),
    JSON.stringify(noSession.json)?.slice(0, 160),
    noSession.status,
  );
  check(
    "no door action reported",
    !/"action"\s*:\s*"(claim|deposit|return)"/.test(JSON.stringify(noSession.json ?? "")),
    JSON.stringify(noSession.json)?.slice(0, 160),
    noSession.status,
  );

  // ── 2. …with the fields an attacker would hope are trusted ────────────────
  section("2. …with a client-supplied kioskId / token / userId");

  const spoofed = await verifyFace(studentToken, {
    kioskId: "KIOSK-001",
    kiosk_id: "KIOSK-001",
    token: `KIOSK-001:${"a".repeat(32)}:${Math.floor(Date.now() / 1000)}:${"b".repeat(16)}`,
    userId: "somebody-else",
  });
  check(
    "still refused — a body field cannot create a session",
    spoofed.status === 400 || spoofed.status === 403,
    `got ${spoofed.status} ${JSON.stringify(spoofed.json)?.slice(0, 160)}`,
    spoofed.status,
  );
  check(
    "same refusal as the plain attempt (the extra fields changed nothing)",
    spoofed.status === noSession.status,
    `plain ${noSession.status} vs spoofed ${spoofed.status}`,
    spoofed.status,
  );

  // ── 3. session/start must not itself open a session ───────────────────────
  section("3. POST /kiosk/session/start does not open a session by itself");

  const startRes = await fetch(`${API}/kiosk/session/start`, {
    method: "POST",
    headers: headers(studentToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      token: `KIOSK-001:${"c".repeat(32)}:${Math.floor(Date.now() / 1000)}:${"d".repeat(16)}`,
      kioskId: "KIOSK-001",
    }),
  });
  console.log(`  (session/start answered ${startRes.status})`);

  const afterStart = await verifyFace(studentToken);
  check(
    "verify-face still refused after a forged session/start",
    afterStart.status === 400 || afterStart.status === 403,
    `got ${afterStart.status} ${JSON.stringify(afterStart.json)?.slice(0, 160)}`,
    afterStart.status,
  );

  // ── 4. only the kiosk's own socket can open a session ─────────────────────
  section("4. kiosk:flow_start from a non-kiosk socket");

  const io = loadSocketIo();
  if (!io) {
    skip("socket probes", "socket.io-client not resolvable from this checkout");
  } else {
    // 4a. Round-trip control: an authenticated student socket DOES get an
    //     answer for the event it is allowed to send.
    const control = await probeSocket(io, {
      auth: { token: studentToken },
      emit: [["app:kiosk_scan", { token: "", rentalId: "", mode: "place" }]],
      listenFor: ["kiosk:scan_error"],
    });
    check(
      "control: student socket connects and gets kiosk:scan_error back",
      control.reply?.event === "kiosk:scan_error",
      control.error ?? `connected=${control.connected} reply=${JSON.stringify(control.reply)}`,
    );

    // 4b. The same socket emitting the kiosk-only event must be ignored.
    const asStudent = await probeSocket(io, {
      auth: { token: studentToken },
      emit: [
        ["kiosk:register", { kiosk_id: "KIOSK-EVIL", locker_count: 4 }],
        ["kiosk:flow_start", { kiosk_id: "KIOSK-001", rental_id: ORPHAN_RENTAL }],
      ],
      listenFor: ["kiosk:command", "kiosk:config"],
    });
    check(
      "student socket cannot drive kiosk:flow_start (no reply at all)",
      asStudent.reply === null,
      `got ${JSON.stringify(asStudent.reply)?.slice(0, 200)}`,
    );

    // 4c. Anonymous socket, same attempt.
    const asAnon = await probeSocket(io, {
      auth: {},
      emit: [
        ["kiosk:register", { kiosk_id: "KIOSK-EVIL", locker_count: 4 }],
        ["kiosk:flow_start", { kiosk_id: "KIOSK-001", rental_id: ORPHAN_RENTAL }],
      ],
      listenFor: ["kiosk:command", "kiosk:config"],
    });
    check(
      "anonymous socket cannot drive kiosk:flow_start (no reply at all)",
      asAnon.reply === null,
      `got ${JSON.stringify(asAnon.reply)?.slice(0, 200)}`,
    );

    // 4d. …and neither attempt left a session behind.
    const afterSocket = await verifyFace(studentToken);
    check(
      "verify-face still refused after both socket attempts",
      afterSocket.status === 400 || afterSocket.status === 403,
      `got ${afterSocket.status}`,
      afterSocket.status,
    );

    // 4e. Positive control — the gate, not the harness, is what silences 4b/4c.
    if (!KIOSK_SECRET) {
      skip(
        "positive control (kiosk-authenticated flow_start answers)",
        "KIOSK_SHARED_SECRET not set — silence above is therefore only " +
          "corroborated by the round-trip control in 4a",
      );
    } else {
      const asKiosk = await probeSocket(io, {
        auth: { kioskSecret: KIOSK_SECRET, kioskId: "KIOSK-001" },
        emit: [["kiosk:flow_start", { kiosk_id: "KIOSK-001", rental_id: ORPHAN_RENTAL }]],
        listenFor: ["kiosk:command"],
      });
      check(
        "control: kiosk-authenticated flow_start IS handled (flow_error for an unknown rental)",
        asKiosk.reply?.event === "kiosk:command" &&
          asKiosk.reply?.payload?.action === "flow_error",
        asKiosk.error ?? `got ${JSON.stringify(asKiosk.reply)?.slice(0, 200)}`,
      );
    }
  }

  // ── summary ───────────────────────────────────────────────────────────────
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
