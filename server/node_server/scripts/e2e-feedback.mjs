/**
 * Stage 3 (feedback loop) end-to-end check, run ON the deployment machine
 * against the live API and its real MySQL — same pattern as the other two
 * e2e-*.mjs scripts in this directory.
 *
 * Covers submission (with and without a screenshot), the student's own
 * status view, admin triage (list/filter/acknowledge/resolve), the resolve
 * notification, authorisation, and rate limiting. The kiosk-event-snapshot
 * capture itself is unit-tested instead (src/utils/__tests__/
 * kioskEventLog.test.ts) — it needs a live kiosk socket connection to
 * populate real events, which is out of scope for an HTTP-only script; this
 * test only confirms the field behaves safely (empty array) with none.
 *
 *   node scripts/e2e-feedback.mjs
 *
 * Env: API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD. Creates one real student
 * account and a few real feedback rows; all deleted at the end regardless
 * of pass/fail.
 */
import { PrismaClient } from "@prisma/client";
import { deflateSync } from "node:zlib";

const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";
const prisma = new PrismaClient();

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

async function jreq(path, { method = "GET", token, body, raw } = {}) {
  const headers = {};
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
  } catch {}
  return { status: res.status, json };
}

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
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
function makePng(w = 120, h = 80) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) raw.push(220, 60, 60);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function submitWithFile(token, fields, png) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (png) fd.append("file", new Blob([png], { type: "image/png" }), "screenshot.png");
  const res = await fetch(`${API}/feedback`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const stamp = Date.now();
const student = {
  email: `feedback.test.${stamp}@uclm.edu.ph`,
  studentId: `FDB-${stamp}`,
  firstName: "Feedback",
  lastName: "TestStudent",
  phoneNumber: "09171234580",
  password: "TestFeedback@2026!",
};

let studentToken = null;
let studentId = null;
let adminToken = null;
const createdFeedbackIds = [];

async function cleanup() {
  console.log("\n--- cleanup ---");
  try {
    await prisma.feedback.deleteMany({ where: { id: { in: createdFeedbackIds } } });
    console.log(`removed ${createdFeedbackIds.length} feedback row(s)`);
    const u = await prisma.user.findUnique({ where: { email: student.email } });
    if (u) {
      await prisma.notification.deleteMany({ where: { userId: u.id } });
      await prisma.feedback.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
      console.log(`removed ${student.email}`);
    }
  } catch (e) {
    console.log("cleanup error (non-fatal):", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function run() {
  section("Setup");
  const reg = await jreq("/auth/register", { method: "POST", body: student });
  check("student registers", reg.status === 201 || reg.status === 200, `status ${reg.status}`);
  studentToken = reg.json?.data?.tokens?.accessToken;
  studentId = reg.json?.data?.user?.id;

  const adminLogin = await jreq("/auth/login", {
    method: "POST",
    body: {
      email: process.env.ADMIN_EMAIL ?? "admin@engirent.edu.ph",
      password: process.env.ADMIN_PASSWORD ?? "EngiRent@2025!",
    },
  });
  adminToken = adminLogin.json?.data?.tokens?.accessToken;
  check("admin can log in", !!adminToken, `status ${adminLogin.status}`);

  section("Validation — the endpoint refuses what it should before touching the DB");
  const noCategory = await jreq("/feedback", { method: "POST", token: studentToken, body: { body: "no category given" } });
  check("missing category is rejected", noCategory.status === 400, `status ${noCategory.status}`);
  const badCategory = await jreq("/feedback", { method: "POST", token: studentToken, body: { category: "NOT_REAL", body: "x" } });
  check("unknown category is rejected", badCategory.status === 400, `status ${badCategory.status}`);
  const noBody = await jreq("/feedback", { method: "POST", token: studentToken, body: { category: "BUG" } });
  check("missing description is rejected", noBody.status === 400, `status ${noBody.status}`);
  const anon = await jreq("/feedback", { method: "POST", body: { category: "BUG", body: "x" } });
  check("anonymous submission is rejected", anon.status === 401, `status ${anon.status}`);

  section("POST /feedback — plain submission (checklist 3.1)");
  const submit1 = await submitWithFile(studentToken, {
    category: "BUG",
    body: "The rental detail screen shows the wrong due date.",
    appVersion: "1.5.2+15",
    device: "Pixel 7 / Android 14",
    screen: "RentalDetailScreen",
  });
  check("submission succeeds", submit1.status === 201, `status ${submit1.status} ${JSON.stringify(submit1.json?.error)}`);
  const fb1 = submit1.json?.data?.feedback?.id;
  if (fb1) createdFeedbackIds.push(fb1);
  check("returns the created id", !!fb1);

  section("POST /feedback — with a screenshot, and context attaches (checklist 3.1's done-when)");
  const submit2 = await submitWithFile(
    studentToken,
    {
      category: "PAYMENT_PROBLEM",
      body: "Paid but the rental still shows AWAITING_DEPOSIT after 10 minutes.",
      appVersion: "1.5.2+15",
      device: "iPhone 13",
      screen: "PaymentWebViewScreen",
    },
    makePng(),
  );
  check("submission with screenshot succeeds", submit2.status === 201, `status ${submit2.status}`);
  const fb2 = submit2.json?.data?.feedback?.id;
  if (fb2) createdFeedbackIds.push(fb2);

  section("POST /feedback — kiosk problem, no live kiosk connected in this test");
  const submit3 = await submitWithFile(studentToken, {
    category: "KIOSK_PROBLEM",
    body: "Locker 3 wouldn't open after face verification succeeded.",
    appVersion: "1.5.2+15",
    kioskId: "kiosk-1",
  });
  check("kiosk-problem submission succeeds", submit3.status === 201, `status ${submit3.status}`);
  const fb3 = submit3.json?.data?.feedback?.id;
  if (fb3) createdFeedbackIds.push(fb3);

  section("rentalId is checked against the reporter, not trusted blindly");
  const fakeRentalReport = await submitWithFile(studentToken, {
    category: "BUG",
    body: "attaching a rental that is not mine",
    appVersion: "1.5.2+15",
    rentalId: "00000000-0000-0000-0000-000000000000",
  });
  check("a nonexistent/foreign rentalId is refused", fakeRentalReport.status === 400, `status ${fakeRentalReport.status}`);

  section("GET /feedback/mine — the loop isn't one-way from the student's side either");
  const mine = await jreq("/feedback/mine", { token: studentToken });
  check("mine returns 200", mine.status === 200, `status ${mine.status}`);
  const mineIds = (mine.json?.data?.feedback ?? []).map((f) => f.id);
  check("all three submissions appear", [fb1, fb2, fb3].every((id) => mineIds.includes(id)));
  check(
    "fresh reports start at NEW",
    (mine.json?.data?.feedback ?? []).filter((f) => createdFeedbackIds.includes(f.id)).every((f) => f.status === "NEW"),
  );

  section("Authorisation — a student cannot read the triage queue");
  const studentReadsQueue = await jreq("/admin/feedback", { token: studentToken });
  check("student is refused", studentReadsQueue.status === 403 || studentReadsQueue.status === 401, `status ${studentReadsQueue.status}`);

  section("Admin: GET /admin/feedback — the queue that didn't exist (checklist 3.3)");
  const queue = await jreq("/admin/feedback?status=NEW&limit=100", { token: adminToken });
  check("queue returns 200", queue.status === 200, `status ${queue.status}`);
  const rows = queue.json?.data?.feedback ?? [];
  const mine1 = rows.find((r) => r.id === fb1);
  const mine2 = rows.find((r) => r.id === fb2);
  const mine3 = rows.find((r) => r.id === fb3);
  check("all three appear in the NEW queue", !!mine1 && !!mine2 && !!mine3);
  check("category is preserved", mine1?.category === "BUG" && mine2?.category === "PAYMENT_PROBLEM" && mine3?.category === "KIOSK_PROBLEM");
  check("appVersion/device/screen context is attached", mine1?.appVersion === "1.5.2+15" && mine1?.device === "Pixel 7 / Android 14" && mine1?.screen === "RentalDetailScreen");
  check("reporter identity is attached", mine1?.user?.email === student.email);
  check("raw screenshotPath is not leaked to the client", mine2?.screenshotPath === undefined);
  check("a signed screenshot URL is minted for the report that has one", !!mine2?.screenshotUrl);
  check("a report with no screenshot has no url", mine1?.screenshotUrl === null);
  check(
    "kiosk-problem report carries a snapshot field (empty here — no live kiosk in this test)",
    Array.isArray(mine3?.kioskEventSnapshot),
    JSON.stringify(mine3?.kioskEventSnapshot),
  );
  check("category glossary is included for the UI", Object.keys(queue.json?.data?.categories ?? {}).length >= 5);

  section("Signed screenshot URL actually resolves and is embeddable");
  const shotRes = await fetch(mine2.screenshotUrl);
  check("screenshot URL returns 200", shotRes.status === 200, `status ${shotRes.status}`);
  check("served as an image", (shotRes.headers.get("content-type") ?? "").startsWith("image/"), shotRes.headers.get("content-type"));
  check(
    "cross-origin embeddable, same fix as the ID-verification evidence panes",
    shotRes.headers.get("cross-origin-resource-policy") === "cross-origin",
  );

  section("Admin: filter by category");
  const paymentOnly = await jreq("/admin/feedback?status=ALL&category=PAYMENT_PROBLEM&limit=100", { token: adminToken });
  const paymentIds = (paymentOnly.json?.data?.feedback ?? []).map((f) => f.id);
  check("category filter narrows correctly", paymentIds.includes(fb2) && !paymentIds.includes(fb1));

  section("Admin: acknowledge (checklist's new -> acknowledged -> resolved)");
  const ack = await jreq(`/admin/feedback/${fb1}`, { method: "PATCH", token: adminToken, body: { status: "ACKNOWLEDGED" } });
  check("acknowledge succeeds", ack.status === 200, `status ${ack.status}`);
  check("status updates", ack.json?.data?.feedback?.status === "ACKNOWLEDGED");
  const ackNotifs = await jreq("/notifications?limit=20", { token: studentToken });
  check(
    "acknowledging does NOT notify — only resolving does, to avoid noise",
    !(ackNotifs.json?.data?.notifications ?? []).some((n) => n.type === "FEEDBACK_UPDATE"),
  );

  section("Admin: resolve, with a note the student can actually read");
  const resolve = await jreq(`/admin/feedback/${fb1}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "RESOLVED", note: "Fixed in the next release — thanks for catching it." },
  });
  check("resolve succeeds", resolve.status === 200, `status ${resolve.status}`);
  check("status is RESOLVED", resolve.json?.data?.feedback?.status === "RESOLVED");
  check("resolver is recorded", !!resolve.json?.data?.feedback?.resolvedById);
  check("resolvedAt is timestamped", !!resolve.json?.data?.feedback?.resolvedAt);

  const afterResolve = await jreq("/feedback/mine", { token: studentToken });
  const resolvedRow = (afterResolve.json?.data?.feedback ?? []).find((f) => f.id === fb1);
  check("the student's own view reflects RESOLVED", resolvedRow?.status === "RESOLVED");
  check("the note is visible to the student", resolvedRow?.adminNote?.includes("Fixed in the next release"));

  const resolveNotifs = await jreq("/notifications?limit=20", { token: studentToken });
  const notif = (resolveNotifs.json?.data?.notifications ?? []).find((n) => n.type === "FEEDBACK_UPDATE");
  check("resolving closes the loop with a real notification", !!notif);
  check("the notification carries the actual note, not a generic message", notif?.message?.includes("Fixed in the next release"));

  section("Admin: invalid transitions and inputs are refused");
  const badStatus = await jreq(`/admin/feedback/${fb2}`, { method: "PATCH", token: adminToken, body: { status: "NEW" } });
  check("cannot move a report back to NEW", badStatus.status === 400, `status ${badStatus.status}`);
  const missingId = await jreq(`/admin/feedback/00000000-0000-0000-0000-000000000000`, { method: "PATCH", token: adminToken, body: { status: "RESOLVED" } });
  check("resolving a nonexistent report 404s", missingId.status === 404, `status ${missingId.status}`);

  section("Rate limiting — a per-user cap, not shared across everyone on the same campus wifi");
  let hitLimit = false;
  let attempts = 0;
  for (let i = 0; i < 12 && !hitLimit; i++) {
    const r = await submitWithFile(studentToken, {
      category: "OTHER",
      body: `rate limit probe ${i}`,
      appVersion: "1.5.2+15",
    });
    attempts++;
    if (r.status === 201 && r.json?.data?.feedback?.id) createdFeedbackIds.push(r.json.data.feedback.id);
    if (r.status === 429) hitLimit = true;
  }
  check("the limiter eventually engages rather than accepting unlimited reports", hitLimit, `no 429 after ${attempts} rapid submissions`);

  console.log(`\n================ ${pass} passed, ${fail} failed ================`);
  if (fail) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
  }
}

run()
  .catch((e) => {
    console.error("HARNESS ERROR", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    process.exit(fail ? 1 : 0);
  });
