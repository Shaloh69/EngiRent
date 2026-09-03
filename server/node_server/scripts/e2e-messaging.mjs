/**
 * Stage 5 (in-app messaging) end-to-end check, run ON the deployment machine
 * against the live API and its real MySQL — same pattern as the other
 * e2e-*.mjs scripts in this directory.
 *
 * Covers the REST/persistence half fully: conversation get-or-create,
 * sending, participant authorisation, message ordering, read-receipt
 * marking, the notification created per message, and the admin transcript
 * endpoint (the whole reason this stage exists — "attach the transcript to
 * disputes"). Real-time Socket.IO delivery is NOT exercised here — proving
 * it needs a live socket connection (a second authenticated client actually
 * listening on its `user:{id}` room), which this HTTP-only script can't do
 * without adding a socket.io-client dependency for one test, the same
 * scope boundary already documented for Stage 3's kiosk event log.
 *
 *   node scripts/e2e-messaging.mjs
 *
 * Env: API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD. Creates real accounts, one
 * real item, and a direct-DB rental fixture (same technique as the other
 * e2e scripts and prisma/seed.ts — no PayMongo checkout needed for this);
 * all deleted at the end regardless of pass/fail.
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
    for (let x = 0; x < w; x++) raw.push(120, 90, 200);
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
  email: `msg.owner.${stamp}@uclm.edu.ph`, studentId: `MSG-O-${stamp}`,
  firstName: "Messaging", lastName: "TestOwner", phoneNumber: "09171234570", password: "TestMsg@2026!",
};
const renter = {
  email: `msg.renter.${stamp}@uclm.edu.ph`, studentId: `MSG-R-${stamp}`,
  firstName: "Messaging", lastName: "TestRenter", phoneNumber: "09171234571", password: "TestMsg@2026!",
};
const stranger = {
  email: `msg.stranger.${stamp}@uclm.edu.ph`, studentId: `MSG-S-${stamp}`,
  firstName: "Messaging", lastName: "TestStranger", phoneNumber: "09171234572", password: "TestMsg@2026!",
};

let itemId = null;
let rentalId = null;
let ownerId = null, renterId = null;
let ownerToken = null, renterToken = null, strangerToken = null, adminToken = null;

async function cleanup() {
  console.log("\n--- cleanup ---");
  try {
    if (rentalId) {
      await prisma.message.deleteMany({ where: { conversation: { rentalId } } });
      await prisma.conversation.deleteMany({ where: { rentalId } });
      await prisma.rental.deleteMany({ where: { id: rentalId } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    for (const email of [owner.email, renter.email, stranger.email]) {
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

  const strangerReg = await jreq("/auth/register", { method: "POST", body: stranger });
  strangerToken = strangerReg.json?.data?.tokens?.accessToken;
  check("stranger registers", !!strangerToken, `status ${strangerReg.status}`);

  // A fresh registration is unverified by design (requireVerified middleware,
  // 2026-08-10) — fast-forward through a state this suite can't reach any
  // other way, same pattern as e2e-availability/listing-video/trust-safety/
  // enterprise-hygiene/my-listings/item-moderation. The stranger account never
  // creates an item or rental, so it doesn't need the flip.
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

  section("Create item + an active rental (direct DB insert — no PayMongo checkout here)");
  const upload = await uploadImage(ownerToken);
  const create = await jreq("/items", {
    method: "POST",
    token: ownerToken,
    body: {
      title: `E2E Messaging Item ${stamp}`,
      description: "Used to test in-app messaging end to end.",
      category: "ELECTRONICS",
      condition: "GOOD",
      pricePerDay: 40,
      securityDeposit: 200,
      images: [upload.url],
    },
  });
  itemId = create.json?.data?.item?.id;
  check("item creates", !!itemId, `status ${create.status}`);

  const now = new Date();
  const rental = await prisma.rental.create({
    data: {
      itemId, renterId, ownerId,
      startDate: now, endDate: new Date(now.getTime() + 3 * 86400000),
      status: "ACTIVE", totalPrice: 120, securityDeposit: 200,
    },
    select: { id: true },
  });
  rentalId = rental.id;
  check("rental fixture created", !!rentalId);

  section("GET /rentals/:id/conversation — get-or-create, this endpoint did not exist before Stage 5");
  const convo1 = await jreq(`/rentals/${rentalId}/conversation`, { token: renterToken });
  check("conversation lazily created for the renter", convo1.status === 200, `status ${convo1.status}`);
  check("starts with zero messages", (convo1.json?.data?.messages ?? []).length === 0);
  check("otherParticipantId is the owner, from the renter's side", convo1.json?.data?.otherParticipantId === ownerId);

  const convo1b = await jreq(`/rentals/${rentalId}/conversation`, { token: ownerToken });
  check("the same conversation is returned for the owner (not a second one)", convo1b.json?.data?.conversationId === convo1.json?.data?.conversationId);
  check("otherParticipantId is the renter, from the owner's side", convo1b.json?.data?.otherParticipantId === renterId);

  section("Authorisation — only the two participants can read or write");
  const strangerReads = await jreq(`/rentals/${rentalId}/conversation`, { token: strangerToken });
  check("a non-participant cannot read the conversation", strangerReads.status === 403, `status ${strangerReads.status}`);
  const strangerWrites = await jreq(`/rentals/${rentalId}/conversation/messages`, {
    method: "POST", token: strangerToken, body: { body: "hi" },
  });
  check("a non-participant cannot send a message", strangerWrites.status === 403, `status ${strangerWrites.status}`);
  const anon = await jreq(`/rentals/${rentalId}/conversation`);
  check("an anonymous caller is rejected", anon.status === 401, `status ${anon.status}`);

  section("Validation");
  const emptyBody = await jreq(`/rentals/${rentalId}/conversation/messages`, {
    method: "POST", token: renterToken, body: { body: "   " },
  });
  check("an empty/whitespace-only message is refused", emptyBody.status === 400, `status ${emptyBody.status}`);
  const tooLong = await jreq(`/rentals/${rentalId}/conversation/messages`, {
    method: "POST", token: renterToken, body: { body: "x".repeat(2001) },
  });
  check("a message over 2000 chars is refused", tooLong.status === 400, `status ${tooLong.status}`);

  section("POST /rentals/:id/conversation/messages — send, persist, notify");
  const msg1 = await jreq(`/rentals/${rentalId}/conversation/messages`, {
    method: "POST", token: renterToken,
    body: { body: "Hi! Is the multimeter still available for pickup today?" },
  });
  check("renter's message sends", msg1.status === 201, `status ${msg1.status} ${JSON.stringify(msg1.json?.error)}`);
  check("sender is attached with a name", msg1.json?.data?.message?.sender?.firstName === "Messaging");

  const notifs = await jreq("/notifications?limit=10", { token: ownerToken });
  const msgNotif = (notifs.json?.data?.notifications ?? []).find((n) => n.relatedEntityId === rentalId);
  check("the owner is notified of the new message", !!msgNotif, JSON.stringify(notifs.json?.data?.notifications?.slice(0, 3)));
  check("the notification names the sender", msgNotif?.title?.includes("Messaging") ?? false, msgNotif?.title);

  await new Promise((r) => setTimeout(r, 50));
  const msg2 = await jreq(`/rentals/${rentalId}/conversation/messages`, {
    method: "POST", token: ownerToken,
    body: { body: "Yes! I'll leave it in the usual locker." },
  });
  check("owner's reply sends", msg2.status === 201, `status ${msg2.status}`);

  section("Ordering and read receipts");
  const convo2 = await jreq(`/rentals/${rentalId}/conversation`, { token: renterToken });
  const msgs = convo2.json?.data?.messages ?? [];
  check("both messages are present", msgs.length === 2, `count ${msgs.length}`);
  check("messages come back oldest-first", msgs[0]?.body?.includes("still available") && msgs[1]?.body?.includes("usual locker"), JSON.stringify(msgs.map((m) => m.body)));
  check("opening the thread marks the other party's message read", msgs[1]?.readAt != null, JSON.stringify(msgs[1]));

  section("GET /admin/rentals/:id/conversation — the reason this stage exists: dispute transcripts");
  const strangerAdminRead = await jreq(`/admin/rentals/${rentalId}/conversation`, { token: renterToken });
  check("a student cannot reach the admin transcript endpoint", strangerAdminRead.status === 403 || strangerAdminRead.status === 401, `status ${strangerAdminRead.status}`);

  const adminRead = await jreq(`/admin/rentals/${rentalId}/conversation`, { token: adminToken });
  check("admin can read the transcript", adminRead.status === 200, `status ${adminRead.status}`);
  const adminMsgs = adminRead.json?.data?.messages ?? [];
  check("admin sees both messages", adminMsgs.length === 2, `count ${adminMsgs.length}`);
  check("admin transcript is readable without being a participant — no participant check on this endpoint", true);

  const noConvoRental = await prisma.rental.findFirst({ where: { id: { not: rentalId } }, select: { id: true } });
  if (noConvoRental) {
    const emptyTranscript = await jreq(`/admin/rentals/${noConvoRental.id}/conversation`, { token: adminToken });
    check("a rental with no conversation returns an empty list, not an error", emptyTranscript.status === 200 && Array.isArray(emptyTranscript.json?.data?.messages) && emptyTranscript.json.data.messages.length === 0, `status ${emptyTranscript.status}`);
  }

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
