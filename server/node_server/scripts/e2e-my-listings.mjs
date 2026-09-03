/**
 * Stage 2 (My Listings) end-to-end check, run ON the deployment machine
 * against the live API and its real MySQL — same pattern as
 * e2e-verification.mjs.
 *
 * Covers what a click-through can't easily prove without a real payment: the
 * "someone currently has this item" state. Creating a genuine ACTIVE rental
 * needs a completed PayMongo checkout, which is out of scope here, so this
 * script inserts one minimal Rental row directly via Prisma to reach that
 * state — the same technique prisma/seed.ts already uses for its four
 * lifecycle-status fixtures. Everything else goes through the real HTTP API.
 *
 *   node scripts/e2e-my-listings.mjs
 *
 * Env: API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD (unused here but kept for
 * parity). Creates real accounts and one real item; both are deleted at the
 * end regardless of pass/fail.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
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

// Tiny valid PNG, same generator as e2e-verification.mjs, so the listing
// photo upload exercises the real /upload/image path end to end.
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
function makePng(w = 200, h = 200) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) raw.push(90, 140, 200);
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
  email: `listings.owner.${stamp}@uclm.edu.ph`,
  studentId: `LST-O-${stamp}`,
  firstName: "Listings",
  lastName: "TestOwner",
  phoneNumber: "09171234570",
  password: "TestListings@2026!",
};
const renter = {
  email: `listings.renter.${stamp}@uclm.edu.ph`,
  studentId: `LST-R-${stamp}`,
  firstName: "Listings",
  lastName: "TestRenter",
  phoneNumber: "09171234571",
  password: "TestListings@2026!",
};

const ITEM_TITLE = `E2E Test Multimeter ${stamp}`;

let itemId = null;
let ownerToken = null;
let ownerId = null;
let renterId = null;
let fakeRentalId = null;

async function cleanup() {
  console.log("\n--- cleanup ---");
  try {
    if (fakeRentalId) {
      await prisma.rental.deleteMany({ where: { id: fakeRentalId } });
      console.log("removed fake rental");
    }
    if (itemId) {
      await prisma.item.deleteMany({ where: { id: itemId } });
      console.log("removed item (hard delete, not the soft-delete API path)");
    }
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
  section("Setup: owner + renter accounts");
  const ownerReg = await jreq("/auth/register", { method: "POST", body: owner });
  check("owner registers", ownerReg.status === 201 || ownerReg.status === 200, `status ${ownerReg.status}`);
  ownerToken = ownerReg.json?.data?.tokens?.accessToken;
  ownerId = ownerReg.json?.data?.user?.id;

  const renterReg = await jreq("/auth/register", { method: "POST", body: renter });
  check("renter registers", renterReg.status === 201 || renterReg.status === 200, `status ${renterReg.status}`);
  renterId = renterReg.json?.data?.user?.id;

  // A fresh registration is unverified by design (requireVerified middleware,
  // 2026-08-10) — fast-forward through a state this suite can't reach any
  // other way, same pattern as e2e-availability/listing-video/trust-safety/
  // enterprise-hygiene.
  await prisma.user.updateMany({
    where: { id: { in: [ownerId, renterId].filter(Boolean) } },
    data: { isVerified: true },
  });

  section("Create a listing through the real flow");
  const upload = await uploadImage(ownerToken);
  check("photo upload succeeds", !!upload?.url, JSON.stringify(upload));

  const create = await jreq("/items", {
    method: "POST",
    token: ownerToken,
    body: {
      title: ITEM_TITLE,
      description: "A multimeter for testing the My Listings screen end to end.",
      category: "MEASUREMENT_TOOLS",
      condition: "GOOD",
      pricePerDay: 45,
      securityDeposit: 300,
      images: [upload.url],
    },
  });
  check("item creates", create.status === 201 || create.status === 200, `status ${create.status} ${JSON.stringify(create.json?.error)}`);
  itemId = create.json?.data?.item?.id;
  if (!itemId) {
    console.error("No item id — cannot continue.");
    await cleanup();
    process.exit(1);
  }

  section("GET /items/my-items — this is the endpoint that was never called");
  let mine = await jreq("/items/my-items", { token: ownerToken });
  check("my-items returns 200", mine.status === 200, `status ${mine.status}`);
  let row = mine.json?.data?.items?.find((i) => i.id === itemId);
  check("the new item appears in my-items", !!row);
  check("owner is populated (ItemModel.fromJson requires it)", !!row?.owner?.firstName, JSON.stringify(row?.owner));
  check("listingState is AVAILABLE for a fresh listing", row?.listingState === "AVAILABLE", row?.listingState);
  check("isListed defaults true", row?.isListed === true);
  check("canDelete is true with no rental", row?.canDelete === true);
  check("activeRental is null", row?.activeRental === null || row?.activeRental === undefined);
  check("reviewCount starts at 0", row?.reviewCount === 0);

  section("The new item is publicly browsable");
  const browse1 = await jreq(`/items?search=${encodeURIComponent(ITEM_TITLE)}`);
  check("appears in public browse", (browse1.json?.data?.items ?? []).some((i) => i.id === itemId));

  section("PUT /items/:id — edit (checklist 2.2)");
  const edit = await jreq(`/items/${itemId}`, {
    method: "PUT",
    token: ownerToken,
    body: { pricePerDay: 60, title: `${ITEM_TITLE} (edited)` },
  });
  check("edit succeeds", edit.status === 200, `status ${edit.status}`);
  mine = await jreq("/items/my-items", { token: ownerToken });
  row = mine.json?.data?.items?.find((i) => i.id === itemId);
  check("price change is reflected", row?.pricePerDay === 60, row?.pricePerDay);
  check("title change is reflected", row?.title?.endsWith("(edited)"));

  section("Unlist / relist (checklist 2.4) — isListed, distinct from isAvailable");
  const unlist = await jreq(`/items/${itemId}`, {
    method: "PUT",
    token: ownerToken,
    body: { isListed: false },
  });
  check("unlist succeeds", unlist.status === 200);
  mine = await jreq("/items/my-items", { token: ownerToken });
  row = mine.json?.data?.items?.find((i) => i.id === itemId);
  check("listingState becomes UNLISTED", row?.listingState === "UNLISTED", row?.listingState);
  check("isAvailable is untouched by unlisting", row?.isAvailable === true);

  const browse2 = await jreq(`/items?search=${encodeURIComponent(ITEM_TITLE)}`);
  check(
    "unlisted item disappears from public browse — the control actually works",
    !(browse2.json?.data?.items ?? []).some((i) => i.id === itemId),
  );

  const relist = await jreq(`/items/${itemId}`, {
    method: "PUT",
    token: ownerToken,
    body: { isListed: true },
  });
  check("relist succeeds", relist.status === 200);
  const browse3 = await jreq(`/items?search=${encodeURIComponent(ITEM_TITLE)}`);
  check("relisted item reappears in browse", (browse3.json?.data?.items ?? []).some((i) => i.id === itemId));

  section("Simulate an active rental (direct DB insert — no PayMongo in scope)");
  const now = new Date();
  const rental = await prisma.rental.create({
    data: {
      itemId,
      renterId,
      ownerId,
      startDate: now,
      endDate: new Date(now.getTime() + 3 * 86400000),
      status: "ACTIVE",
      totalPrice: 180,
      securityDeposit: 300,
    },
    select: { id: true },
  });
  fakeRentalId = rental.id;
  check("rental row created", !!fakeRentalId);

  section("My-items reflects the active rental");
  mine = await jreq("/items/my-items", { token: ownerToken });
  row = mine.json?.data?.items?.find((i) => i.id === itemId);
  check("listingState becomes RENTED", row?.listingState === "RENTED", row?.listingState);
  check("canDelete flips to false", row?.canDelete === false);
  check("activeRental is populated", !!row?.activeRental);
  // The raw API nests { renter: { firstName, lastName } }; the flattened
  // renterName string only exists in the Flutter model that parses this
  // (ActiveRentalSummary.fromJson), so assert the shape the wire actually
  // sends.
  check(
    "activeRental names the renter",
    row?.activeRental?.renter?.firstName === "Listings" &&
      row?.activeRental?.renter?.lastName === "TestRenter",
    JSON.stringify(row?.activeRental?.renter),
  );

  section("isAvailable cannot be forced true while a rental is in flight");
  const forceAvailable = await jreq(`/items/${itemId}`, {
    method: "PUT",
    token: ownerToken,
    body: { isAvailable: true },
  });
  check("blocked with a real validation error, not a silent no-op", forceAvailable.status === 400, `status ${forceAvailable.status}`);
  check("the error explains what to do instead", /[Uu]nlist/.test(forceAvailable.json?.error ?? ""), forceAvailable.json?.error);

  section("isListed still works while rented — unlisting doesn't touch the rental");
  const unlistWhileRented = await jreq(`/items/${itemId}`, {
    method: "PUT",
    token: ownerToken,
    body: { isListed: false },
  });
  check("unlisting a rented item succeeds", unlistWhileRented.status === 200);
  mine = await jreq("/items/my-items", { token: ownerToken });
  row = mine.json?.data?.items?.find((i) => i.id === itemId);
  check(
    "RENTED still takes display priority over UNLISTED",
    row?.listingState === "RENTED",
    row?.listingState,
  );
  check("but isListed itself really is false underneath", row?.isListed === false);
  // Relist for the delete-refusal check below, so that failure is isolated
  // to the rental guard and not compounded with the unlisted state.
  await jreq(`/items/${itemId}`, { method: "PUT", token: ownerToken, body: { isListed: true } });

  section("DELETE is refused while a rental is in flight (checklist 2.4's stated bar)");
  const blockedDelete = await jreq(`/items/${itemId}`, { method: "DELETE", token: ownerToken });
  check("delete refused with 400, not a generic failure", blockedDelete.status === 400, `status ${blockedDelete.status}`);
  check("refusal names the reason", /active rental/i.test(blockedDelete.json?.error ?? ""), blockedDelete.json?.error);
  const stillThere = await jreq("/items/my-items", { token: ownerToken });
  check("item was not deleted", stillThere.json?.data?.items?.some((i) => i.id === itemId));

  section("Rental completes — item becomes deletable again");
  await prisma.rental.delete({ where: { id: fakeRentalId } });
  fakeRentalId = null;
  mine = await jreq("/items/my-items", { token: ownerToken });
  row = mine.json?.data?.items?.find((i) => i.id === itemId);
  check("listingState returns to AVAILABLE", row?.listingState === "AVAILABLE", row?.listingState);
  check("canDelete is true again", row?.canDelete === true);

  section("Authorisation — a stranger cannot edit or delete someone else's item");
  const renterToken = (await jreq("/auth/login", { method: "POST", body: { email: renter.email, password: renter.password } })).json?.data?.tokens?.accessToken;
  const strangerEdit = await jreq(`/items/${itemId}`, { method: "PUT", token: renterToken, body: { title: "hijacked" } });
  check("a non-owner cannot edit the item", strangerEdit.status === 403, `status ${strangerEdit.status}`);
  const strangerDelete = await jreq(`/items/${itemId}`, { method: "DELETE", token: renterToken });
  check("a non-owner cannot delete the item", strangerDelete.status === 403, `status ${strangerDelete.status}`);

  section("DELETE /items/:id — the other endpoint that was never called");
  const del = await jreq(`/items/${itemId}`, { method: "DELETE", token: ownerToken });
  check("delete succeeds now that nothing is attached", del.status === 200, `status ${del.status}`);
  mine = await jreq("/items/my-items", { token: ownerToken });
  check("deleted item no longer appears in my-items", !mine.json?.data?.items?.some((i) => i.id === itemId));
  const browse4 = await jreq(`/items?search=${encodeURIComponent(ITEM_TITLE)}`);
  check("deleted item no longer appears in public browse", !(browse4.json?.data?.items ?? []).some((i) => i.id === itemId));
  itemId = null; // already gone through the real API path — cleanup() should not also hard-delete it

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
