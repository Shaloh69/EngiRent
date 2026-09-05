/**
 * Stage 3.5 end-to-end check, run ON the deployment machine against the live
 * API (localhost:5000) and the live MySQL behind it.
 *
 * Drives the same sequence the Flutter app drives — register, register-face
 * (real ML service), id-photo, profile/complete — then exercises the admin
 * queue and both decisions, and finally reads back what the student's own
 * profile call returns, because that is what the app renders.
 *
 * The face payload is an existing face.jpg already in storage: the ML service
 * genuinely runs face detection, so a synthetic image would be rejected and
 * the test would prove nothing. The ID payload IS synthetic (generated PNG) —
 * deliberately, so no real person's ID document ends up in a test fixture or
 * a screenshot.
 *
 *   node scripts/e2e-verification.mjs <path-to-a-real-face.jpg>
 *
 * Env: API_BASE_URL, E2E_OUT_DIR, ADMIN_EMAIL, ADMIN_PASSWORD.
 * It creates real accounts (`verify.test.*@uclm.edu.ph`) — run it against a
 * dev/staging database, and clear them out afterwards.
 *
 * Note the two media assertions near the end of the "signed evidence URLs"
 * block. Every JSON check here passed while the admin page still showed empty
 * evidence panes, because the bytes were served with a same-origin CORP header
 * and a content type taken from the .jpg path rather than the actual format.
 * An API-only test cannot see that; those two assertions are what stand in for
 * the browser.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";

/**
 * Rate-limit bypass. The API allows 100 requests per 15-minute window per IP,
 * and this suite alone can exceed that — so `scripts/e2e-all.mjs` cannot run
 * the set end to end without it. Unset means the header is simply absent and
 * normal limits apply, so the default is unchanged and it fails closed.
 * Every use is logged at warn server-side (middleware/rateLimiter.ts).
 */
const BYPASS = process.env.RATE_LIMIT_BYPASS_SECRET
  ? { "X-RateLimit-Bypass": process.env.RATE_LIMIT_BYPASS_SECRET }
  : {};
const OUT_DIR = process.env.E2E_OUT_DIR ?? ".";
mkdirSync(OUT_DIR, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(t) {
  console.log(`\n=== ${t} ===`);
}

// ── A synthetic "ID card" PNG, hand-encoded (no image library on this box) ────
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function makeIdPng(w = 320, h = 200) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0); // filter byte: none
    for (let x = 0; x < w; x++) {
      // Banded card-ish look so the admin pane shows something structured
      // rather than a flat rectangle — easy to recognise as generated.
      const header = y < 46;
      const stripe = y > 60 && y < 74 && x > 16 && x < 240;
      const stripe2 = y > 92 && y < 106 && x > 16 && x < 190;
      const photo = x > 236 && x < 304 && y > 60 && y < 150;
      if (header) raw.push(11, 95, 165);
      else if (photo) raw.push(180, 196, 212);
      else if (stripe || stripe2) raw.push(120, 134, 150);
      else raw.push(238, 241, 245);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function jreq(path, { method = "GET", token, body, raw } = {}) {
  const headers = { ...BYPASS };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !raw) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON is a real outcome worth reporting, not an exception */
  }
  return { status: res.status, json };
}

async function upload(path, token, buf, filename, type) {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type }), filename);
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...BYPASS },
    body: fd,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const stamp = Date.now();
const students = [
  {
    label: "A (approve path)",
    email: `verify.test.a.${stamp}@uclm.edu.ph`,
    studentId: `TST-A-${stamp}`,
    firstName: "Verify",
    lastName: "TestAlpha",
    phoneNumber: "09171234567",
    password: "TestVerify@2026!",
  },
  {
    label: "B (reject path)",
    email: `verify.test.b.${stamp}@uclm.edu.ph`,
    studentId: `TST-B-${stamp}`,
    firstName: "Verify",
    lastName: "TestBravo",
    phoneNumber: "09171234568",
    password: "TestVerify@2026!",
  },
];

const idPng = makeIdPng();
const facePath = process.argv[2];
if (!facePath) {
  console.error("usage: node e2e-verification.mjs <path-to-real-face.jpg>");
  process.exit(2);
}
const faceJpg = readFileSync(facePath);

const results = {};

async function run() {
  section("Admin authentication");
  const adminLogin = await jreq("/auth/login", {
    method: "POST",
    body: {
      email: process.env.ADMIN_EMAIL ?? "admin@engirent.edu.ph",
      password: process.env.ADMIN_PASSWORD ?? "EngiRent@2025!",
    },
  });
  check("admin can log in", adminLogin.status === 200, `status ${adminLogin.status}`);
  const adminToken = adminLogin.json?.data?.tokens?.accessToken;
  if (!adminToken) {
    console.error("No admin token — cannot continue.", JSON.stringify(adminLogin.json));
    process.exit(1);
  }

  section("Student signup through the real flow");
  for (const s of students) {
    const reg = await jreq("/auth/register", { method: "POST", body: s });
    check(`${s.label}: register`, reg.status === 201 || reg.status === 200, `status ${reg.status} ${JSON.stringify(reg.json?.message ?? reg.json?.errors ?? "")}`);
    const token = reg.json?.data?.tokens?.accessToken;
    s.token = token;
    s.id = reg.json?.data?.user?.id;

    // A brand-new account must not be verified and must not be in the queue.
    check(
      `${s.label}: starts UNSUBMITTED and unverified`,
      reg.json?.data?.user?.isVerified === false,
      `isVerified=${reg.json?.data?.user?.isVerified}`,
    );

    const face = await upload("/auth/register-face", token, faceJpg, "face.jpg", "image/jpeg");
    check(`${s.label}: register-face accepted by ML`, face.status === 200 && face.json?.data?.encoding, `status ${face.status} ${JSON.stringify(face.json?.message ?? "")}`);
    s.encoding = face.json?.data?.encoding;

    const id = await upload("/auth/id-photo", token, idPng, "id.png", "image/png");
    check(`${s.label}: id-photo stored`, id.status === 200, `status ${id.status}`);

    const done = await jreq("/auth/profile/complete", {
      method: "POST",
      token,
      body: { faceEncoding: s.encoding, biometricConsent: true },
    });
    check(`${s.label}: profile/complete`, done.status === 200, `status ${done.status} ${JSON.stringify(done.json?.message ?? "")}`);
    check(
      `${s.label}: completing profile moves them to PENDING`,
      done.json?.data?.user?.verificationStatus === "PENDING",
      `got ${done.json?.data?.user?.verificationStatus}`,
    );
  }

  section("Admin queue");
  const q = await jreq("/admin/id-verifications?status=PENDING&limit=50", { token: adminToken });
  check("queue returns 200", q.status === 200, `status ${q.status}`);
  const rows = q.json?.data?.verifications ?? [];
  const mine = rows.filter((r) => students.some((s) => s.id === r.id));
  check("both new students appear in the PENDING queue", mine.length === 2, `found ${mine.length}`);

  const rowA = rows.find((r) => r.id === students[0].id);
  check("queue row carries a signed ID photo URL", !!rowA?.idPhotoUrl, `idPhotoUrl=${rowA?.idPhotoUrl}`);
  check("queue row carries a signed face photo URL", !!rowA?.facePhotoUrl, `facePhotoUrl=${rowA?.facePhotoUrl}`);
  check("raw idImageUrl path is not leaked to the client", rowA?.idImageUrl === undefined, `got ${rowA?.idImageUrl}`);
  check("reject reasons are supplied to the UI", Object.keys(q.json?.data?.rejectReasons ?? {}).length >= 3, `${Object.keys(q.json?.data?.rejectReasons ?? {}).length} reasons`);

  // Oldest-first: A registered before B, so A must precede B.
  const iA = rows.findIndex((r) => r.id === students[0].id);
  const iB = rows.findIndex((r) => r.id === students[1].id);
  check("queue is ordered oldest-first", iA > -1 && iB > -1 && iA < iB, `A@${iA} B@${iB}`);

  section("Signed evidence URLs actually resolve");
  const idRes = await fetch(rowA.idPhotoUrl);
  const idBuf = Buffer.from(await idRes.arrayBuffer());
  check("signed ID photo URL returns 200", idRes.status === 200, `status ${idRes.status}`);
  check("signed ID photo is served as an image", (idRes.headers.get("content-type") ?? "").startsWith("image/"), idRes.headers.get("content-type"));
  check("signed ID photo bytes match what was uploaded", idBuf.length === idPng.length && idBuf.equals(idPng), `${idBuf.length} vs ${idPng.length} bytes`);
  writeFileSync(`${OUT_DIR}/e2e-id-roundtrip.png`, idBuf);

  // The two failures that made the admin page useless while every JSON check
  // above still passed. Both are invisible to an API-only test.
  check(
    "ID photo content-type matches the real bytes, not the .jpg path",
    idRes.headers.get("content-type") === "image/png",
    `got ${idRes.headers.get("content-type")} for PNG bytes (nosniff means a wrong type = blank pane)`,
  );
  check(
    "media is embeddable cross-origin (CORP)",
    idRes.headers.get("cross-origin-resource-policy") === "cross-origin",
    `got ${idRes.headers.get("cross-origin-resource-policy")} — admin console is a different origin from the API`,
  );

  const faceRes = await fetch(rowA.facePhotoUrl);
  check("signed face photo URL returns 200", faceRes.status === 200, `status ${faceRes.status}`);

  // The whole point of the signed URL is that the path is not guessable.
  const tampered = rowA.idPhotoUrl.slice(0, -4) + "0000";
  const tamperRes = await fetch(tampered);
  check("a tampered signature is rejected", tamperRes.status >= 400, `status ${tamperRes.status}`);

  section("Authorisation");
  const asStudent = await jreq("/admin/id-verifications", { token: students[0].token });
  check("a student cannot read the queue", asStudent.status === 403 || asStudent.status === 401, `status ${asStudent.status}`);
  const anon = await jreq("/admin/id-verifications");
  check("an anonymous caller cannot read the queue", anon.status === 401, `status ${anon.status}`);
  const studentDecide = await jreq(`/admin/id-verifications/${students[1].id}`, {
    method: "POST",
    token: students[0].token,
    body: { decision: "APPROVE" },
  });
  check("a student cannot decide their own verification", studentDecide.status === 403 || studentDecide.status === 401, `status ${studentDecide.status}`);

  section("Rejection requires a usable reason");
  const noReason = await jreq(`/admin/id-verifications/${students[1].id}`, {
    method: "POST",
    token: adminToken,
    body: { decision: "REJECT" },
  });
  check("reject with no reason is refused", noReason.status === 400, `status ${noReason.status}`);
  const badReason = await jreq(`/admin/id-verifications/${students[1].id}`, {
    method: "POST",
    token: adminToken,
    body: { decision: "REJECT", reason: "BECAUSE_I_SAID_SO" },
  });
  check("reject with an unknown reason is refused", badReason.status === 400, `status ${badReason.status}`);

  section("Reject path (student B)");
  const rej = await jreq(`/admin/id-verifications/${students[1].id}`, {
    method: "POST",
    token: adminToken,
    body: { decision: "REJECT", reason: "UNREADABLE", note: "The student number is blurred." },
  });
  check("reject succeeds", rej.status === 200, `status ${rej.status} ${JSON.stringify(rej.json?.message ?? "")}`);
  check("rejected student is NOT verified", rej.json?.data?.user?.isVerified === false, `isVerified=${rej.json?.data?.user?.isVerified}`);
  check("rejection status stored", rej.json?.data?.user?.verificationStatus === "REJECTED");
  check("rejection reason stored", rej.json?.data?.user?.verificationReason === "UNREADABLE", `got ${rej.json?.data?.user?.verificationReason}`);
  check("reviewer note stored", !!rej.json?.data?.user?.verificationNote);

  const bProfile = await jreq("/auth/profile", { token: students[1].token });
  check("student's own profile reports REJECTED", bProfile.json?.data?.user?.verificationStatus === "REJECTED", `got ${bProfile.json?.data?.user?.verificationStatus}`);
  check("student's own profile carries the reason the app renders", bProfile.json?.data?.user?.verificationReason === "UNREADABLE", `got ${bProfile.json?.data?.user?.verificationReason}`);

  const bNotifs = await jreq("/notifications?limit=10", { token: students[1].token });
  const rejNotif = (bNotifs.json?.data?.notifications ?? []).find((n) => n.type === "VERIFICATION_FAILED");
  check("rejected student was notified", !!rejNotif, `types: ${(bNotifs.json?.data?.notifications ?? []).map((n) => n.type).join(",")}`);
  check("the notification says what to fix", !!rejNotif && /blurred|unreadable|read/i.test(rejNotif.message), rejNotif?.message);

  section("Re-submit after rejection (student B)");
  const idPng2 = makeIdPng(340, 210);
  const reUp = await upload("/auth/id-photo", students[1].token, idPng2, "id.png", "image/png");
  check("re-submitted ID photo accepted", reUp.status === 200, `status ${reUp.status}`);
  const reDone = await jreq("/auth/profile/complete", {
    method: "POST",
    token: students[1].token,
    body: { faceEncoding: students[1].encoding, biometricConsent: true },
  });
  check("re-submit returns to PENDING", reDone.json?.data?.user?.verificationStatus === "PENDING", `got ${reDone.json?.data?.user?.verificationStatus}`);
  const bAfter = await jreq("/auth/profile", { token: students[1].token });
  check(
    "the stale rejection reason is cleared on re-submit",
    !bAfter.json?.data?.user?.verificationReason,
    `still shows ${bAfter.json?.data?.user?.verificationReason}`,
  );

  section("Approve path (student A)");
  const app = await jreq(`/admin/id-verifications/${students[0].id}`, {
    method: "POST",
    token: adminToken,
    body: { decision: "APPROVE" },
  });
  check("approve succeeds", app.status === 200, `status ${app.status}`);
  check("approval flips isVerified", app.json?.data?.user?.isVerified === true, `isVerified=${app.json?.data?.user?.isVerified}`);
  check("approval status stored", app.json?.data?.user?.verificationStatus === "APPROVED");
  check("approval clears any prior reason", app.json?.data?.user?.verificationReason === null);
  check("decision is timestamped", !!app.json?.data?.user?.verifiedAt);

  const aProfile = await jreq("/auth/profile", { token: students[0].token });
  check("approved student's profile reports APPROVED", aProfile.json?.data?.user?.verificationStatus === "APPROVED");
  check("approved student is verified in their own profile", aProfile.json?.data?.user?.isVerified === true);

  const aNotifs = await jreq("/notifications?limit=10", { token: students[0].token });
  check("approved student was notified", (aNotifs.json?.data?.notifications ?? []).some((n) => n.type === "VERIFICATION_SUCCESS"));

  section("Queue reflects the decisions");
  const qAfter = await jreq("/admin/id-verifications?status=PENDING&limit=50", { token: adminToken });
  const stillPending = (qAfter.json?.data?.verifications ?? []).map((r) => r.id);
  check("approved student left the pending queue", !stillPending.includes(students[0].id));
  check("re-submitted student is back in the pending queue", stillPending.includes(students[1].id));

  const qApproved = await jreq("/admin/id-verifications?status=APPROVED&limit=50", { token: adminToken });
  const approvedRow = (qApproved.json?.data?.verifications ?? []).find((r) => r.id === students[0].id);
  check("approved student appears under the APPROVED filter", !!approvedRow);
  check("decided row records who reviewed it", !!approvedRow?.verifiedById, `verifiedById=${approvedRow?.verifiedById}`);

  const qAll = await jreq("/admin/id-verifications?status=ALL&limit=100", { token: adminToken });
  check("ALL filter returns everyone", (qAll.json?.data?.verifications ?? []).length >= 2);

  results.studentA = students[0].id;
  results.studentB = students[1].id;
  results.emailA = students[0].email;
  results.emailB = students[1].email;
  writeFileSync(`${OUT_DIR}/e2e-verification-result.json`, JSON.stringify(results, null, 2));

  console.log(`\n================ ${pass} passed, ${fail} failed ================`);
  if (fail) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log(`Test students: A=${students[0].email} B=${students[1].email}`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(3);
});
