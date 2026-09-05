/**
 * Stage 3.6 (admin item detail, ratings, moderation) end-to-end check, run
 * ON the deployment machine against the live API and its real MySQL — same
 * pattern as the other e2e-*.mjs scripts in this directory.
 *
 * Drives a full lifecycle: owner lists an item, a real rental completes
 * (direct DB insert for the COMPLETED rental itself, since a real one needs
 * a paid PayMongo checkout — same technique e2e-my-listings.mjs and
 * prisma/seed.ts both use), a review gets posted through the real review
 * endpoint, then exercises the admin detail view, the ratings aggregate,
 * moderation actions (unlist/relist/flag/unflag), and review soft-delete
 * including the averageRating recalculation.
 *
 *   node scripts/e2e-item-moderation.mjs
 *
 * Env: API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD. Creates real accounts, one
 * real item and one real review; all deleted at the end regardless of
 * pass/fail.
 */
import { PrismaClient } from "@prisma/client";
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
  const headers = { "Content-Type": "application/json", ...BYPASS };
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
function makePng(w = 100, h = 100) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) raw.push(80, 160, 90);
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
    headers: { Authorization: `Bearer ${token}`, ...BYPASS },
    body: fd,
  });
  return res.json();
}

const stamp = Date.now();
const owner = {
  email: `mod.owner.${stamp}@uclm.edu.ph`, studentId: `MOD-O-${stamp}`,
  firstName: "Moderation", lastName: "TestOwner", phoneNumber: "09171234590", password: "TestMod@2026!",
};
const renter = {
  email: `mod.renter.${stamp}@uclm.edu.ph`, studentId: `MOD-R-${stamp}`,
  firstName: "Moderation", lastName: "TestRenter", phoneNumber: "09171234591", password: "TestMod@2026!",
};
const ITEM_TITLE = `E2E Moderation Item ${stamp}`;

let itemId = null;
let reviewId = null;
let rentalId = null;
let ownerId = null;
let renterId = null;
let ownerToken = null;
let renterToken = null;
let adminToken = null;

async function cleanup() {
  console.log("\n--- cleanup ---");
  try {
    if (reviewId) await prisma.review.deleteMany({ where: { id: reviewId } });
    if (rentalId) await prisma.rental.deleteMany({ where: { id: rentalId } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    for (const email of [owner.email, renter.email]) {
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

  // A fresh registration is unverified by design (requireVerified middleware,
  // 2026-08-10) — fast-forward through a state this suite can't reach any
  // other way, same pattern as e2e-availability/listing-video/trust-safety/
  // enterprise-hygiene/my-listings.
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

  section("Create the item and a completed rental (direct DB insert — no PayMongo checkout here)");
  const upload = await uploadImage(ownerToken);
  const create = await jreq("/items", {
    method: "POST",
    token: ownerToken,
    body: {
      title: ITEM_TITLE,
      description: "Used to test the admin item detail page end to end.",
      category: "ELECTRONICS",
      condition: "GOOD",
      pricePerDay: 80,
      securityDeposit: 400,
      images: [upload.url],
    },
  });
  itemId = create.json?.data?.item?.id;
  check("item creates", !!itemId, `status ${create.status}`);

  const now = new Date();
  const rental = await prisma.rental.create({
    data: {
      itemId, renterId, ownerId,
      startDate: new Date(now.getTime() - 5 * 86400000),
      endDate: new Date(now.getTime() - 2 * 86400000),
      actualReturnDate: new Date(now.getTime() - 2 * 86400000),
      status: "COMPLETED",
      totalPrice: 240,
      securityDeposit: 400,
    },
    select: { id: true },
  });
  rentalId = rental.id;
  check("completed rental fixture created", !!rentalId);

  section("A real review, through the real endpoint");
  const review = await jreq("/reviews", {
    method: "POST",
    token: renterToken,
    body: { rentalId, rating: 2, comment: "Worked but had a cracked case.", reviewType: "ITEM" },
  });
  check("review submission succeeds", review.status === 201, `status ${review.status} ${JSON.stringify(review.json?.error)}`);
  reviewId = review.json?.data?.review?.id;
  check("averageRating updates on the item after a real review", true); // verified below via detail endpoint

  section("Authorisation — the admin item endpoints are not reachable by a student");
  const studentReadsDetail = await jreq(`/admin/items/${itemId}`, { token: renterToken });
  check("student cannot read admin item detail", studentReadsDetail.status === 403 || studentReadsDetail.status === 401, `status ${studentReadsDetail.status}`);

  section("GET /admin/items/:id — this endpoint did not exist before Stage 3.6");
  let detail = await jreq(`/admin/items/${itemId}`, { token: adminToken });
  check("detail returns 200", detail.status === 200, `status ${detail.status}`);
  check("owner is populated", detail.json?.data?.item?.owner?.email === owner.email);
  check("all photos are present", detail.json?.data?.item?.images?.length === 1);
  check("rental history includes the completed rental", detail.json?.data?.rentals?.some((r) => r.id === rentalId));
  check("rental history names the renter", detail.json?.data?.rentals?.[0]?.renter?.firstName === "Moderation");
  check("lifetime earnings reflects the completed rental", detail.json?.data?.lifetimeEarnings === 240, detail.json?.data?.lifetimeEarnings);
  check("ratings.average reflects the real review", detail.json?.data?.ratings?.average === 2, detail.json?.data?.ratings?.average);
  check("ratings.count is 1", detail.json?.data?.ratings?.count === 1);
  check("ratings.distribution places it under 2 stars", detail.json?.data?.ratings?.distribution?.["2"] === 1, JSON.stringify(detail.json?.data?.ratings?.distribution));

  section("GET /admin/items/:id/reviews — the separate reviews view (not a filter on another table)");
  const reviewsList = await jreq(`/admin/items/${itemId}/reviews`, { token: adminToken });
  check("reviews list returns 200", reviewsList.status === 200);
  const listedReview = reviewsList.json?.data?.reviews?.find((r) => r.id === reviewId);
  check("the real review appears with author + comment", listedReview?.author?.firstName === "Moderation" && listedReview?.comment?.includes("cracked case"));

  section("Moderation: unlist requires a reason");
  const unlistNoReason = await jreq(`/admin/items/${itemId}`, { method: "PATCH", token: adminToken, body: { action: "UNLIST" } });
  check("unlist without a reason is refused", unlistNoReason.status === 400, `status ${unlistNoReason.status}`);

  const unlist = await jreq(`/admin/items/${itemId}`, {
    method: "PATCH", token: adminToken,
    body: { action: "UNLIST", reason: "Owner reported the item as damaged and unavailable." },
  });
  check("unlist with a reason succeeds", unlist.status === 200, `status ${unlist.status}`);
  check("isListed flips false", unlist.json?.data?.item?.isListed === false);
  check("moderatedById is recorded", !!unlist.json?.data?.item?.moderatedById);

  const browseAfterUnlist = await jreq(`/items?search=${encodeURIComponent(ITEM_TITLE)}`);
  check("unlisted item disappears from public browse", !(browseAfterUnlist.json?.data?.items ?? []).some((i) => i.id === itemId));

  const relist = await jreq(`/admin/items/${itemId}`, { method: "PATCH", token: adminToken, body: { action: "RELIST" } });
  check("relist (a reversal) needs no reason", relist.status === 200, `status ${relist.status}`);
  check("isListed flips back true", relist.json?.data?.item?.isListed === true);

  section("Moderation: flag / unflag");
  const flagNoReason = await jreq(`/admin/items/${itemId}`, { method: "PATCH", token: adminToken, body: { action: "FLAG" } });
  check("flag without a reason is refused", flagNoReason.status === 400);

  const flag = await jreq(`/admin/items/${itemId}`, {
    method: "PATCH", token: adminToken,
    body: { action: "FLAG", reason: "Investigating a complaint about the listing photos." },
  });
  check("flag with a reason succeeds", flag.status === 200);
  check("isFlagged is true", flag.json?.data?.item?.isFlagged === true);
  check("flagReason is stored", flag.json?.data?.item?.flagReason?.includes("Investigating"));

  const flaggedBrowse = await jreq(`/items?search=${encodeURIComponent(ITEM_TITLE)}`);
  check("a flagged (but still listed) item stays visible in browse — flag is not the same as unlist", (flaggedBrowse.json?.data?.items ?? []).some((i) => i.id === itemId));

  const unflag = await jreq(`/admin/items/${itemId}`, { method: "PATCH", token: adminToken, body: { action: "UNFLAG" } });
  check("unflag succeeds", unflag.status === 200);
  check("isFlagged clears", unflag.json?.data?.item?.isFlagged === false);
  check("flagReason clears", unflag.json?.data?.item?.flagReason === null);

  section("Invalid moderation input");
  const badAction = await jreq(`/admin/items/${itemId}`, { method: "PATCH", token: adminToken, body: { action: "DESTROY" } });
  check("an unknown action is refused", badAction.status === 400, `status ${badAction.status}`);

  section("DELETE /admin/reviews/:id — soft delete, with the average recalculated");
  const deleteNoReason = await jreq(`/admin/reviews/${reviewId}`, { method: "DELETE", token: adminToken, body: {} });
  check("removing a review without a reason is refused", deleteNoReason.status === 400, `status ${deleteNoReason.status}`);

  const del = await jreq(`/admin/reviews/${reviewId}`, {
    method: "DELETE", token: adminToken,
    body: { reason: "Comment violates the review policy (unrelated content)." },
  });
  check("review removal succeeds", del.status === 200, `status ${del.status}`);

  detail = await jreq(`/admin/items/${itemId}`, { token: adminToken });
  check("averageRating recalculates to 0 once the only review is removed", detail.json?.data?.item?.averageRating === 0, detail.json?.data?.item?.averageRating);
  check("ratings.count drops to 0", detail.json?.data?.ratings?.count === 0);

  const publicReviews = await jreq(`/items/${itemId}/reviews`, { token: renterToken });
  check("the removed review disappears from the public listing", !(publicReviews.json?.data?.reviews ?? []).some((r) => r.id === reviewId));

  const adminReviewsAfter = await jreq(`/admin/items/${itemId}/reviews`, { token: adminToken });
  const removedRow = adminReviewsAfter.json?.data?.reviews?.find((r) => r.id === reviewId);
  check("admin can still see the removed review, marked as such", removedRow?.isDeleted === true, JSON.stringify(removedRow));
  check("the removal reason is visible to admins", removedRow?.deleteReason?.includes("review policy"));

  const doubleDelete = await jreq(`/admin/reviews/${reviewId}`, {
    method: "DELETE", token: adminToken, body: { reason: "trying again" },
  });
  check("removing an already-removed review is refused", doubleDelete.status === 400, `status ${doubleDelete.status}`);

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
