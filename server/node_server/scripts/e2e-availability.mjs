/**
 * Stage 6 (date-based availability) end-to-end check, run ON the deployment
 * machine against the live API and its real MySQL — same pattern as the
 * other e2e-*.mjs scripts in this directory.
 *
 * Covers: overlap rejection at booking time, acceptance of a genuinely free
 * range on the same item, the public /items/:id/booked-dates endpoint
 * (what the checkout calendar reads), and that isAvailable is *derived*
 * from whichever rental currently spans "now" rather than being latched
 * false by any booking that merely exists somewhere in the future.
 *
 *   node scripts/e2e-availability.mjs
 *
 * Env: API_BASE_URL. Creates real accounts and one real item; all deleted
 * at the end regardless of pass/fail.
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
    for (let x = 0; x < w; x++) raw.push(60, 160, 140);
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

function iso(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 86400000).toISOString();
}

const stamp = Date.now();
const owner = {
  email: `avail.owner.${stamp}@uclm.edu.ph`, studentId: `AVL-O-${stamp}`,
  firstName: "Availability", lastName: "TestOwner", phoneNumber: "09171234580", password: "TestAvl@2026!",
};
const renterA = {
  email: `avail.rentera.${stamp}@uclm.edu.ph`, studentId: `AVL-RA-${stamp}`,
  firstName: "Availability", lastName: "RenterA", phoneNumber: "09171234581", password: "TestAvl@2026!",
};
const renterB = {
  email: `avail.renterb.${stamp}@uclm.edu.ph`, studentId: `AVL-RB-${stamp}`,
  firstName: "Availability", lastName: "RenterB", phoneNumber: "09171234582", password: "TestAvl@2026!",
};

let itemId = null;
let ownerId = null;
const rentalIds = [];
let ownerToken = null, renterAToken = null, renterBToken = null;

async function cleanup() {
  console.log("\n--- cleanup ---");
  try {
    if (rentalIds.length) {
      await prisma.rental.deleteMany({ where: { id: { in: rentalIds } } });
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
  check("renter A registers", !!renterAToken, `status ${renterAReg.status}`);

  const renterBReg = await jreq("/auth/register", { method: "POST", body: renterB });
  renterBToken = renterBReg.json?.data?.tokens?.accessToken;
  check("renter B registers", !!renterBToken, `status ${renterBReg.status}`);

  section("Create item");
  const upload = await uploadImage(ownerToken);
  const create = await jreq("/items", {
    method: "POST",
    token: ownerToken,
    body: {
      title: `E2E Availability Item ${stamp}`,
      description: "Used to test date-based availability end to end.",
      category: "ELECTRONICS",
      condition: "GOOD",
      pricePerDay: 25,
      securityDeposit: 100,
      images: [upload.url],
    },
  });
  itemId = create.json?.data?.item?.id;
  check("item creates", !!itemId, `status ${create.status}`);
  check("item starts available", create.json?.data?.item?.isAvailable === true);

  section("Booking a future range");
  const rentalA = await jreq("/rentals", {
    method: "POST", token: renterAToken,
    body: { itemId, startDate: iso(10), endDate: iso(13) },
  });
  const rentalAId = rentalA.json?.data?.rental?.id;
  if (rentalAId) rentalIds.push(rentalAId);
  check("renter A books days 10–13", rentalA.status === 201, `status ${rentalA.status} ${JSON.stringify(rentalA.json?.error)}`);

  section("Overlap rejection");
  const overlapStart = await jreq("/rentals", {
    method: "POST", token: renterBToken,
    body: { itemId, startDate: iso(9), endDate: iso(11) },
  });
  check("overlap at the start edge (9–11) is rejected", overlapStart.status === 400, `status ${overlapStart.status}`);

  const overlapMiddle = await jreq("/rentals", {
    method: "POST", token: renterBToken,
    body: { itemId, startDate: iso(11), endDate: iso(12) },
  });
  check("overlap fully inside (11–12) is rejected", overlapMiddle.status === 400, `status ${overlapMiddle.status}`);

  const overlapEnd = await jreq("/rentals", {
    method: "POST", token: renterBToken,
    body: { itemId, startDate: iso(12), endDate: iso(15) },
  });
  check("overlap at the end edge (12–15) is rejected", overlapEnd.status === 400, `status ${overlapEnd.status}`);
  check("overlap rejection message explains why", (overlapEnd.json?.error ?? "").toLowerCase().includes("booked"), JSON.stringify(overlapEnd.json));

  section("A genuinely free range on the same item is accepted");
  const rentalC = await jreq("/rentals", {
    method: "POST", token: renterBToken,
    body: { itemId, startDate: iso(20), endDate: iso(23) },
  });
  const rentalCId = rentalC.json?.data?.rental?.id;
  if (rentalCId) rentalIds.push(rentalCId);
  check("renter B books the non-overlapping days 20–23", rentalC.status === 201, `status ${rentalC.status} ${JSON.stringify(rentalC.json?.error)}`);

  section("GET /items/:id/booked-dates — what the checkout calendar reads");
  const booked = await jreq(`/items/${itemId}/booked-dates`);
  const ranges = booked.json?.data?.bookedRanges ?? [];
  check("booked-dates is reachable without auth", booked.status === 200, `status ${booked.status}`);
  check("both accepted bookings are reported", ranges.length === 2, `count ${ranges.length}: ${JSON.stringify(ranges)}`);

  section("isAvailable reflects only what covers *now*, not any future booking");
  const afterFutureBookings = await jreq(`/items/${itemId}`);
  check("item still shows available today — bookings are 10+ days out", afterFutureBookings.json?.data?.item?.isAvailable === true, JSON.stringify(afterFutureBookings.json?.data?.item?.isAvailable));

  section("A booking that starts today flips isAvailable false");
  const rentalNow = await jreq("/rentals", {
    method: "POST", token: renterAToken,
    body: { itemId, startDate: iso(0), endDate: iso(2) },
  });
  const rentalNowId = rentalNow.json?.data?.rental?.id;
  if (rentalNowId) rentalIds.push(rentalNowId);
  check("renter A books starting today", rentalNow.status === 201, `status ${rentalNow.status} ${JSON.stringify(rentalNow.json?.error)}`);

  const afterNowBooking = await jreq(`/items/${itemId}`);
  check("item now shows unavailable", afterNowBooking.json?.data?.item?.isAvailable === false, JSON.stringify(afterNowBooking.json?.data?.item?.isAvailable));

  section("Cancelling the covering rental recomputes isAvailable back to true");
  const cancel = await jreq(`/rentals/${rentalNowId}/cancel`, { method: "POST", token: renterAToken });
  check("the today-spanning rental cancels", cancel.status === 200, `status ${cancel.status}`);

  const afterCancel = await jreq(`/items/${itemId}`);
  check("item is available again — the future bookings don't cover today", afterCancel.json?.data?.item?.isAvailable === true, JSON.stringify(afterCancel.json?.data?.item?.isAvailable));

  section("A cancelled rental's dates free up for booking by someone else");
  const rebookCancelledSlot = await jreq("/rentals", {
    method: "POST", token: renterBToken,
    body: { itemId, startDate: iso(0), endDate: iso(2) },
  });
  const rebookId = rebookCancelledSlot.json?.data?.rental?.id;
  if (rebookId) rentalIds.push(rebookId);
  check("the same 0–2 day range can be rebooked once the prior rental is cancelled", rebookCancelledSlot.status === 201, `status ${rebookCancelledSlot.status} ${JSON.stringify(rebookCancelledSlot.json?.error)}`);

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
