/**
 * Stage 8 (trust & safety) end-to-end check, run ON the deployment machine
 * against the live API and its real MySQL — same pattern as the other
 * e2e-*.mjs scripts in this directory.
 *
 * Covers: settleDispute's new damage-fee-cap validation (rejects a fee
 * above the held deposit, accepts one at or under it), the owner
 * completion-rate and renter on-time-rate reputation stats computed live
 * by GET /reviews/user/:id (including a currently-open dispute correctly
 * dragging the owner's rate down, and a LATE_FEE transaction correctly
 * dragging the renter's rate down), and the new ITEM_REPORT feedback
 * category (itemId attached, validated, visible to admin triage).
 *
 *   node scripts/e2e-trust-safety.mjs
 *
 * Env: API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD. Creates real accounts, one
 * real item, and direct-DB rental/transaction fixtures (same technique as
 * the other e2e scripts and prisma/seed.ts — no PayMongo checkout needed
 * for this); all deleted at the end regardless of pass/fail.
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

async function jreq(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
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
function makePng(w = 60, h = 60) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) raw.push(140, 90, 200);
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
async function uploadImage(token) {
  const fd = new FormData();
  fd.append("file", new Blob([makePng()], { type: "image/png" }), "cover.png");
  const res = await fetch(`${API}/upload/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return res.json();
}

const stamp = Date.now();
const owner = {
  email: `trust.owner.${stamp}@uclm.edu.ph`, studentId: `TRO-${stamp}`,
  firstName: "Trust", lastName: "TestOwner", phoneNumber: "09171234610", password: "TestTrust@2026!",
};
const renterA = {
  email: `trust.rentera.${stamp}@uclm.edu.ph`, studentId: `TRA-${stamp}`,
  firstName: "Trust", lastName: "RenterA", phoneNumber: "09171234611", password: "TestTrust@2026!",
};
const renterB = {
  email: `trust.renterb.${stamp}@uclm.edu.ph`, studentId: `TRB-${stamp}`,
  firstName: "Trust", lastName: "RenterB", phoneNumber: "09171234612", password: "TestTrust@2026!",
};

let itemId = null;
let ownerId = null, renterAId = null, renterBId = null;
let ownerToken = null, renterAToken = null, adminToken = null;
const rentalIds = [];
const feedbackIds = [];

async function cleanup() {
  console.log("\n--- cleanup ---");
  try {
    if (rentalIds.length) {
      await prisma.transaction.deleteMany({ where: { rentalId: { in: rentalIds } } });
      await prisma.rental.deleteMany({ where: { id: { in: rentalIds } } });
    }
    if (feedbackIds.length) {
      await prisma.feedback.deleteMany({ where: { id: { in: feedbackIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    for (const email of [owner.email, renterA.email, renterB.email]) {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.notification.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
        console.log(`removed ${email}`);
      }
    }
  } catch (e) {
    console.log("cleanup error (non-fatal):", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function run() {
  section("Setup");
  const ownerReg = await jreq("/auth/register", { method: "POST", body: owner });
  ownerToken = ownerReg.json?.data?.tokens?.accessToken;
  ownerId = ownerReg.json?.data?.user?.id;
  check("owner registers", !!ownerToken, `status ${ownerReg.status}`);

  const renterAReg = await jreq("/auth/register", { method: "POST", body: renterA });
  renterAToken = renterAReg.json?.data?.tokens?.accessToken;
  renterAId = renterAReg.json?.data?.user?.id;
  check("renter A registers", !!renterAToken, `status ${renterAReg.status}`);

  const renterBReg = await jreq("/auth/register", { method: "POST", body: renterB });
  renterBId = renterBReg.json?.data?.user?.id;
  check("renter B registers", !!renterBId, `status ${renterBReg.status}`);

  // Follow-up (2026-08-10) — listing and renting now require a verified account.
  await prisma.user.updateMany({
    where: { id: { in: [ownerId, renterAId, renterBId].filter(Boolean) } },
    data: { isVerified: true },
  });

  const adminLogin = await jreq("/auth/login", {
    method: "POST",
    body: {
      email: process.env.ADMIN_EMAIL ?? "admin@engirent.edu.ph",
      password: process.env.ADMIN_PASSWORD ?? "EngiRent@2025!",
    },
  });
  adminToken = adminLogin.json?.data?.tokens?.accessToken;
  check("admin logs in", !!adminToken, `status ${adminLogin.status}`);

  section("Create item");
  const upload = await uploadImage(ownerToken);
  const create = await jreq("/items", {
    method: "POST", token: ownerToken,
    body: {
      title: `E2E Trust & Safety Item ${stamp}`,
      description: "Used to test reputation and damage-fee-cap end to end.",
      category: "ELECTRONICS", condition: "GOOD",
      pricePerDay: 25, securityDeposit: 150,
      images: [upload.url],
    },
  });
  itemId = create.json?.data?.item?.id;
  check("item creates", !!itemId, `status ${create.status}`);

  section("Fixture: a completed rental (renter A, on time — no LATE_FEE)");
  const now = new Date();
  const completedOnTime = await prisma.rental.create({
    data: {
      itemId, renterId: renterAId, ownerId,
      startDate: new Date(now.getTime() - 5 * 86400000),
      endDate: new Date(now.getTime() - 2 * 86400000),
      status: "COMPLETED", completedAt: now,
      totalPrice: 75, securityDeposit: 150,
    },
    select: { id: true },
  });
  rentalIds.push(completedOnTime.id);
  check("on-time completed fixture created", !!completedOnTime.id);

  section("Fixture: an open (unresolved) dispute for the owner");
  const disputed = await prisma.rental.create({
    data: {
      itemId, renterId: renterBId, ownerId,
      startDate: new Date(now.getTime() - 5 * 86400000),
      endDate: new Date(now.getTime() - 2 * 86400000),
      status: "DISPUTED",
      totalPrice: 75, securityDeposit: 150,
    },
    select: { id: true },
  });
  rentalIds.push(disputed.id);
  check("disputed fixture created", !!disputed.id);

  section("Reputation reflects the open dispute BEFORE it's resolved");
  const repBefore = await jreq(`/reviews/user/${ownerId}?limit=1`);
  const beforeRate = repBefore.json?.data?.reputation?.completionRate;
  check("owner completion rate is 50% with 1 completed + 1 open dispute", Math.abs((beforeRate ?? -1) - 0.5) < 0.001, JSON.stringify(repBefore.json?.data?.reputation));

  section("settleDispute — damage fee cannot exceed the held deposit");
  const overCap = await jreq(`/admin/rentals/${disputed.id}/settle`, {
    method: "POST", token: adminToken,
    body: { outcome: "owner_wins", damageFee: 999, notes: "way over the deposit" },
  });
  check("a damage fee above the deposit is rejected", overCap.status === 400, `status ${overCap.status}`);

  const withinCap = await jreq(`/admin/rentals/${disputed.id}/settle`, {
    method: "POST", token: adminToken,
    body: { outcome: "owner_wins", damageFee: 100, notes: "within the deposit" },
  });
  check("a damage fee at/under the deposit is accepted", withinCap.status === 200, `status ${withinCap.status} ${JSON.stringify(withinCap.json)}`);

  section("Reputation reflects the resolved dispute AFTER settlement");
  const repAfter = await jreq(`/reviews/user/${ownerId}?limit=1`);
  const afterRate = repAfter.json?.data?.reputation?.completionRate;
  check("owner completion rate is 100% once the dispute resolves to COMPLETED", Math.abs((afterRate ?? -1) - 1) < 0.001, JSON.stringify(repAfter.json?.data?.reputation));
  check("totalRentalsAsOwner is 2", repAfter.json?.data?.reputation?.totalRentalsAsOwner === 2);

  section("Fixture: a second completed rental for renter A, this one late (has a LATE_FEE transaction)");
  const completedLate = await prisma.rental.create({
    data: {
      itemId, renterId: renterAId, ownerId,
      startDate: new Date(now.getTime() - 10 * 86400000),
      endDate: new Date(now.getTime() - 8 * 86400000),
      status: "COMPLETED", completedAt: now,
      totalPrice: 50, securityDeposit: 150,
    },
    select: { id: true },
  });
  rentalIds.push(completedLate.id);
  await prisma.transaction.create({
    data: {
      rentalId: completedLate.id, userId: renterAId,
      type: "LATE_FEE", amount: 25, status: "COMPLETED",
      paidAt: now, paymentMethod: "Held Deposit Deduction",
    },
  });
  check("late-completed fixture + LATE_FEE transaction created", true);

  section("Renter on-time rate reflects the late return");
  const renterRep = await jreq(`/reviews/user/${renterAId}?limit=1`);
  const onTimeRate = renterRep.json?.data?.reputation?.onTimeRate;
  check("renter A's on-time rate is 50% (1 on-time of 2 completed)", Math.abs((onTimeRate ?? -1) - 0.5) < 0.001, JSON.stringify(renterRep.json?.data?.reputation));
  check("totalRentalsAsRenter is 2", renterRep.json?.data?.reputation?.totalRentalsAsRenter === 2);

  section("A user with no concluded rentals as OWNER reads as null, not 0%");
  // Renter B's own DISPUTED-then-settled rental (above) makes them a
  // renter with 1 completed (on-time — settlement only added a DAMAGE_FEE,
  // not a LATE_FEE) rental, so onTimeRate is legitimately 100% here, not
  // null. completionRate as OWNER is the null case: renter B has never
  // owned anything.
  const freshRep = await jreq(`/reviews/user/${renterBId}?limit=1`);
  check("renter B has no owner track record — null completionRate, not 0%", freshRep.json?.data?.reputation?.completionRate === null, JSON.stringify(freshRep.json?.data?.reputation));
  check("renter B's one settled rental counts as an on-time completion for them as renter", freshRep.json?.data?.reputation?.onTimeRate === 1 && freshRep.json?.data?.reputation?.totalRentalsAsRenter === 1, JSON.stringify(freshRep.json?.data?.reputation));

  section("ITEM_REPORT feedback category — report a listing");
  const report = await jreq("/feedback", {
    method: "POST", token: renterAToken,
    body: { category: "ITEM_REPORT", body: "This listing looks like a duplicate photo scam.", itemId, appVersion: "test" },
  });
  feedbackIds.push(report.json?.data?.feedback?.id);
  check("item report submits", report.status === 201, `status ${report.status} ${JSON.stringify(report.json)}`);
  check("category is ITEM_REPORT", report.json?.data?.feedback?.category === "ITEM_REPORT");

  const badItem = await jreq("/feedback", {
    method: "POST", token: renterAToken,
    body: { category: "ITEM_REPORT", body: "Reporting a made-up item id.", itemId: "00000000-0000-0000-0000-000000000000", appVersion: "test" },
  });
  check("a garbage itemId is rejected", badItem.status === 400, `status ${badItem.status}`);

  const noItemReport = await jreq("/feedback", {
    method: "POST", token: renterAToken,
    body: { category: "ITEM_REPORT", body: "General category test with no itemId.", appVersion: "test" },
  });
  feedbackIds.push(noItemReport.json?.data?.feedback?.id);
  check("ITEM_REPORT without an itemId is still accepted (itemId is optional)", noItemReport.status === 201, `status ${noItemReport.status}`);

  section("Admin triage sees the report with its itemId");
  const adminList = await jreq(`/admin/feedback?status=ALL&category=ITEM_REPORT&limit=50`, { token: adminToken });
  check("admin can list ITEM_REPORT feedback", adminList.status === 200, `status ${adminList.status}`);
  const found = (adminList.json?.data?.feedback ?? []).find((f) => f.id === report.json?.data?.feedback?.id);
  check("the report is visible to admin with its itemId attached", found?.itemId === itemId, JSON.stringify(found));
  check("categories list now includes ITEM_REPORT's label", adminList.json?.data?.categories?.ITEM_REPORT === "Report a listing", JSON.stringify(adminList.json?.data?.categories));

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
