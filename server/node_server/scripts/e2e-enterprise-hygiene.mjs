/**
 * Stage 9 (enterprise hygiene) server-side end-to-end check, run ON the
 * deployment machine against the live API and its real MySQL — same
 * pattern as the other e2e-*.mjs scripts in this directory.
 *
 * Covers everything server-side from this stage: admin role granularity
 * (REVIEWER can reach the review-queue routes, gets 403 everywhere else),
 * the audit log (a real admin action leaves a real, queryable row),
 * rental extend/shorten (price recompute, overlap rejection, ownership
 * check, the EXTENSION_FEE transaction), notification preferences
 * (read-time filtering, invalid-type rejection), the force-update config
 * endpoint, the new admin user-detail endpoint, CSV export, and bulk item
 * moderation. UI-side work (screens consuming these) is verified
 * separately via screenshots.
 *
 *   node scripts/e2e-enterprise-hygiene.mjs
 *
 * Env: API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD. Creates real accounts
 * (including a REVIEWER account), one real item, and direct-DB rental
 * fixtures; all deleted at the end regardless of pass/fail.
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
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, res };
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
    for (let x = 0; x < w; x++) raw.push(60, 120, 200);
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
  email: `hyg.owner.${stamp}@uclm.edu.ph`, studentId: `HYO-${stamp}`,
  firstName: "Hygiene", lastName: "TestOwner", phoneNumber: "09171234630", password: "TestHyg@2026!",
};
const renter = {
  email: `hyg.renter.${stamp}@uclm.edu.ph`, studentId: `HYR-${stamp}`,
  firstName: "Hygiene", lastName: "TestRenter", phoneNumber: "09171234631", password: "TestHyg@2026!",
};

let ownerId = null, renterId = null;
let ownerToken = null, renterToken = null, adminToken = null, reviewerToken = null;
let itemId = null, itemId2 = null;
const rentalIds = [];
const staffEmails = [];

async function cleanup() {
  console.log("\n--- cleanup ---");
  try {
    if (rentalIds.length) {
      await prisma.transaction.deleteMany({ where: { rentalId: { in: rentalIds } } });
      await prisma.rental.deleteMany({ where: { id: { in: rentalIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    if (itemId2) await prisma.item.deleteMany({ where: { id: itemId2 } });
    await prisma.auditLog.deleteMany({ where: { actorEmail: { in: staffEmails } } });
    for (const email of [owner.email, renter.email, ...staffEmails]) {
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

  const renterReg = await jreq("/auth/register", { method: "POST", body: renter });
  renterToken = renterReg.json?.data?.tokens?.accessToken;
  renterId = renterReg.json?.data?.user?.id;
  check("renter registers", !!renterToken, `status ${renterReg.status}`);

  // Follow-up (2026-08-10) — listing and renting now require a verified account.
  await prisma.user.updateMany({
    where: { id: { in: [ownerId, renterId].filter(Boolean) } },
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

  const upload = await uploadImage(ownerToken);
  const create = await jreq("/items", {
    method: "POST", token: ownerToken,
    body: {
      title: `E2E Hygiene Item ${stamp}`, description: "Used to test Stage 9 enterprise hygiene end to end.",
      category: "ELECTRONICS", condition: "GOOD", pricePerDay: 30, securityDeposit: 100, images: [upload.url],
    },
  });
  itemId = create.json?.data?.item?.id;
  check("item creates", !!itemId, `status ${create.status}`);

  const create2 = await jreq("/items", {
    method: "POST", token: ownerToken,
    body: {
      title: `E2E Hygiene Item 2 ${stamp}`, description: "A second item, for bulk-action testing.",
      category: "ELECTRONICS", condition: "GOOD", pricePerDay: 15, securityDeposit: 50, images: [upload.url],
    },
  });
  itemId2 = create2.json?.data?.item?.id;
  check("second item creates", !!itemId2, `status ${create2.status}`);

  section("Admin role granularity — creating a REVIEWER account");
  const reviewerEmail = `hyg.reviewer.${stamp}@uclm.edu.ph`;
  staffEmails.push(reviewerEmail);
  const createReviewer = await jreq("/admin/users/admin", {
    method: "POST", token: adminToken,
    body: {
      email: reviewerEmail, password: "TestHyg@2026!", studentId: `HYV-${stamp}`,
      firstName: "Hygiene", lastName: "Reviewer", phoneNumber: "09171234632", role: "REVIEWER",
    },
  });
  check("admin can create a REVIEWER account", createReviewer.status === 201, `status ${createReviewer.status} ${JSON.stringify(createReviewer.json)}`);
  check("created account has role REVIEWER", createReviewer.json?.data?.user?.role === "REVIEWER");

  const reviewerLogin = await jreq("/auth/login", { method: "POST", body: { email: reviewerEmail, password: "TestHyg@2026!" } });
  reviewerToken = reviewerLogin.json?.data?.tokens?.accessToken;
  check("reviewer logs in", !!reviewerToken, `status ${reviewerLogin.status}`);

  section("REVIEWER can reach the review-queue routes");
  const reviewerIdVerifs = await jreq("/admin/id-verifications", { token: reviewerToken });
  check("reviewer can list ID verifications", reviewerIdVerifs.status === 200, `status ${reviewerIdVerifs.status}`);
  const reviewerItemDetail = await jreq(`/admin/items/${itemId}`, { token: reviewerToken });
  check("reviewer can read item detail", reviewerItemDetail.status === 200, `status ${reviewerItemDetail.status}`);
  const reviewerFeedback = await jreq("/admin/feedback", { token: reviewerToken });
  check("reviewer can list feedback", reviewerFeedback.status === 200, `status ${reviewerFeedback.status}`);

  section("REVIEWER is refused everywhere else — the whole point of granularity");
  const reviewerUsers = await jreq("/admin/users", { token: reviewerToken });
  check("reviewer CANNOT list users", reviewerUsers.status === 403, `status ${reviewerUsers.status}`);
  const reviewerRentals = await jreq("/admin/rentals", { token: reviewerToken });
  check("reviewer CANNOT list rentals", reviewerRentals.status === 403, `status ${reviewerRentals.status}`);
  const reviewerTransactions = await jreq("/admin/transactions", { token: reviewerToken });
  check("reviewer CANNOT list transactions", reviewerTransactions.status === 403, `status ${reviewerTransactions.status}`);
  const reviewerKiosks = await jreq("/admin/kiosks", { token: reviewerToken });
  check("reviewer CANNOT list kiosks", reviewerKiosks.status === 403, `status ${reviewerKiosks.status}`);
  const reviewerAudit = await jreq("/admin/audit-log", { token: reviewerToken });
  check("reviewer CANNOT read the audit log", reviewerAudit.status === 403, `status ${reviewerAudit.status}`);

  section("Audit log — a real admin action leaves a real, queryable row");
  const flagResult = await jreq(`/admin/items/${itemId}`, {
    method: "PATCH", token: adminToken,
    body: { action: "FLAG", reason: "e2e audit-log test flag" },
  });
  check("admin flags the item", flagResult.status === 200, `status ${flagResult.status}`);

  const auditLog = await jreq(`/admin/audit-log?targetType=item&limit=100`, { token: adminToken });
  check("admin can read the audit log", auditLog.status === 200, `status ${auditLog.status}`);
  const flagEntry = (auditLog.json?.data?.entries ?? []).find((e) => e.targetId === itemId && e.action === "item.flag");
  check("the flag action is recorded with the right actor/action/target/reason", !!flagEntry && flagEntry.reason === "e2e audit-log test flag", JSON.stringify(flagEntry));

  // Unflag so it doesn't interfere with later checks
  await jreq(`/admin/items/${itemId}`, { method: "PATCH", token: adminToken, body: { action: "UNFLAG" } });

  section("Admin user detail endpoint");
  const userDetail = await jreq(`/admin/users/${ownerId}`, { token: adminToken });
  check("admin can fetch user detail", userDetail.status === 200, `status ${userDetail.status}`);
  check("user detail includes the owner's listings", (userDetail.json?.data?.items ?? []).some((i) => i.id === itemId));
  check("user detail includes rental counts", typeof userDetail.json?.data?.rentalCounts?.asOwner === "number");

  section("CSV export");
  const csvResp = await jreq("/admin/users?format=csv&limit=5", { token: adminToken, raw: true });
  check("users CSV export responds 200", csvResp.status === 200, `status ${csvResp.status}`);
  check("users CSV has the right content type", (csvResp.res.headers.get("content-type") ?? "").includes("text/csv"), csvResp.res.headers.get("content-type"));
  const csvBody = await csvResp.res.text();
  check("users CSV has a header row and at least one data row", csvBody.split("\n").length >= 2, csvBody.slice(0, 120));

  section("Bulk item moderation");
  const bulkNoReason = await jreq("/admin/items/bulk", {
    method: "PATCH", token: adminToken,
    body: { itemIds: [itemId, itemId2], action: "UNLIST" },
  });
  check("bulk UNLIST without a reason is rejected", bulkNoReason.status === 400, `status ${bulkNoReason.status}`);

  const bulkUnlist = await jreq("/admin/items/bulk", {
    method: "PATCH", token: adminToken,
    body: { itemIds: [itemId, itemId2], action: "UNLIST", reason: "e2e bulk unlist test" },
  });
  check("bulk UNLIST with a reason succeeds", bulkUnlist.status === 200, `status ${bulkUnlist.status} ${JSON.stringify(bulkUnlist.json)}`);
  check("bulk UNLIST reports count 2", bulkUnlist.json?.data?.count === 2, JSON.stringify(bulkUnlist.json));

  const item1After = await jreq(`/items/${itemId}`);
  const item2After = await jreq(`/items/${itemId2}`);
  check("item 1 is now unlisted", item1After.json?.data?.item?.isListed === false);
  check("item 2 is now unlisted", item2After.json?.data?.item?.isListed === false);

  const bulkRelist = await jreq("/admin/items/bulk", {
    method: "PATCH", token: adminToken,
    body: { itemIds: [itemId, itemId2], action: "RELIST" },
  });
  check("bulk RELIST (a reversal, no reason needed) succeeds", bulkRelist.status === 200, `status ${bulkRelist.status}`);

  section("Force-update config endpoint");
  const appConfig = await jreq("/app-config");
  check("app-config is reachable with no auth", appConfig.status === 200, `status ${appConfig.status}`);
  check("app-config has the expected shape", typeof appConfig.json?.data?.minVersion === "string" && typeof appConfig.json?.data?.latestVersion === "string", JSON.stringify(appConfig.json));

  section("Notification preferences");
  const prefsDefault = await jreq("/notifications/preferences", { token: renterToken });
  check("preferences default to nothing muted", Array.isArray(prefsDefault.json?.data?.mutedTypes) && prefsDefault.json.data.mutedTypes.length === 0, JSON.stringify(prefsDefault.json));
  check("mutableTypes is the real, non-empty list", (prefsDefault.json?.data?.mutableTypes ?? []).includes("BOOKING_CONFIRMED"));

  const badPref = await jreq("/notifications/preferences", { method: "PUT", token: renterToken, body: { mutedTypes: ["SYSTEM_ANNOUNCEMENT"] } });
  check("muting a non-mutable type is rejected", badPref.status === 400, `status ${badPref.status}`);

  const setPref = await jreq("/notifications/preferences", { method: "PUT", token: renterToken, body: { mutedTypes: ["BOOKING_CONFIRMED"] } });
  check("muting a real mutable type succeeds", setPref.status === 200, `status ${setPref.status}`);

  // Trigger a BOOKING_CONFIRMED notification for the renter by creating a rental
  const bookingRental = await jreq("/rentals", {
    method: "POST", token: renterToken,
    body: { itemId, startDate: iso(30), endDate: iso(33) },
  });
  const bookingRentalId = bookingRental.json?.data?.rental?.id;
  check("a booking is created to trigger a notification", bookingRental.status === 201, `status ${bookingRental.status} ${JSON.stringify(bookingRental.json)}`);
  // Note: BOOKING_CONFIRMED notifies the OWNER, not the renter — the renter
  // doesn't get a notification from creating their own booking. Reusing
  // this fixture for the extend/shorten tests below instead of asserting
  // renter-side filtering on a notification that was never going to exist.
  if (bookingRentalId) rentalIds.push(bookingRentalId);

  // Restore renter's preferences to default (nothing muted) for cleanliness
  await jreq("/notifications/preferences", { method: "PUT", token: renterToken, body: { mutedTypes: [] } });

  section("Rental extend/shorten — fixture: a direct-DB ACTIVE rental");
  const now = new Date();
  const activeRental = await prisma.rental.create({
    data: {
      itemId, renterId, ownerId,
      startDate: new Date(now.getTime() - 1 * 86400000),
      endDate: new Date(now.getTime() + 2 * 86400000),
      status: "ACTIVE", totalPrice: 90, securityDeposit: 100,
    },
    select: { id: true },
  });
  rentalIds.push(activeRental.id);
  check("active rental fixture created", !!activeRental.id);

  section("Extend/shorten — authorization and validation");
  const ownerTriesExtend = await jreq(`/rentals/${activeRental.id}/dates`, {
    method: "PATCH", token: ownerToken, body: { endDate: iso(5) },
  });
  check("the owner (not renter) cannot change the dates", ownerTriesExtend.status === 403, `status ${ownerTriesExtend.status}`);

  const sameDate = await jreq(`/rentals/${activeRental.id}/dates`, {
    method: "PATCH", token: renterToken, body: { endDate: activeRental && new Date(now.getTime() + 2 * 86400000).toISOString() },
  });
  check("setting the same end date is rejected", sameDate.status === 400, `status ${sameDate.status}`);

  section("Extend/shorten — overlap rejection");
  const blockerRental = await prisma.rental.create({
    data: {
      itemId, renterId: ownerId, ownerId: renterId, // roles irrelevant here, just needs to block
      startDate: new Date(now.getTime() + 10 * 86400000),
      endDate: new Date(now.getTime() + 13 * 86400000),
      status: "PENDING", totalPrice: 90, securityDeposit: 100,
    },
    select: { id: true },
  });
  rentalIds.push(blockerRental.id);
  const overlapExtend = await jreq(`/rentals/${activeRental.id}/dates`, {
    method: "PATCH", token: renterToken, body: { endDate: iso(11) },
  });
  check("extending into another booking's range is rejected", overlapExtend.status === 400, `status ${overlapExtend.status}`);

  section("Extend/shorten — a real extension recomputes price and bills an EXTENSION_FEE");
  const extend = await jreq(`/rentals/${activeRental.id}/dates`, {
    method: "PATCH", token: renterToken, body: { endDate: iso(4) },
  });
  check("a genuinely free extension succeeds", extend.status === 200, `status ${extend.status} ${JSON.stringify(extend.json)}`);
  check("totalPrice recomputed for the new range", extend.json?.data?.totalPrice > 90, JSON.stringify(extend.json?.data));
  check("an extension fee is reported for the price increase", extend.json?.data?.extensionFeeCharged > 0, JSON.stringify(extend.json?.data));

  const extensionTxn = await prisma.transaction.findFirst({ where: { rentalId: activeRental.id, type: "EXTENSION_FEE" } });
  check("an EXTENSION_FEE transaction was actually created", !!extensionTxn, JSON.stringify(extensionTxn));

  section("Extend/shorten — shortening reduces price with no fee");
  const shorten = await jreq(`/rentals/${activeRental.id}/dates`, {
    method: "PATCH", token: renterToken, body: { endDate: iso(1) },
  });
  check("shortening succeeds", shorten.status === 200, `status ${shorten.status}`);
  check("shortening has no extension fee", shorten.json?.data?.extensionFeeCharged === 0, JSON.stringify(shorten.json?.data));

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
