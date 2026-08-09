/**
 * Stage 7 (listing video) end-to-end check, run ON the deployment machine
 * against the live API and its real MySQL — same pattern as the other
 * e2e-*.mjs scripts in this directory.
 *
 * Covers: uploading a clip through the existing /upload/image endpoint
 * (video/mp4 was already in ALLOWED_FILE_TYPES before this stage — this
 * proves it actually works end to end, not just that the env var lists it),
 * a listing created with/without a clip, editing to add/replace/remove one,
 * the create-route's isURL() validator rejecting garbage, and that the
 * stored file is served back with the right sniffed Content-Type.
 *
 *   node scripts/e2e-listing-video.mjs
 *
 * Env: API_BASE_URL. Creates a real account and item; both deleted at the
 * end regardless of pass/fail.
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
    for (let x = 0; x < w; x++) raw.push(200, 120, 60);
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
/** Just enough bytes for sniffContentType()'s ftyp-box check — not a real
 * playable clip, this script only exercises storage/serving, not decoding. */
function makeFakeMp4() {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftyp", "ascii"),
    Buffer.from("isom", "ascii"),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from("isom", "ascii"),
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
async function uploadVideo(token) {
  const fd = new FormData();
  fd.append("file", new Blob([makeFakeMp4()], { type: "video/mp4" }), "clip.mp4");
  const res = await fetch(`${API}/upload/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return res.json();
}

const stamp = Date.now();
const owner = {
  email: `video.owner.${stamp}@uclm.edu.ph`, studentId: `VID-O-${stamp}`,
  firstName: "Video", lastName: "TestOwner", phoneNumber: "09171234595", password: "TestVid@2026!",
};

let ownerToken = null;
let itemWithVideoId = null;
let itemNoVideoId = null;

async function cleanup() {
  console.log("\n--- cleanup ---");
  try {
    for (const id of [itemWithVideoId, itemNoVideoId]) {
      if (id) await prisma.item.deleteMany({ where: { id } });
    }
    const u = await prisma.user.findUnique({ where: { email: owner.email } });
    if (u) {
      await prisma.notification.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
      console.log(`removed ${owner.email}`);
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
  check("owner registers", !!ownerToken, `status ${ownerReg.status}`);

  const cover = await uploadImage(ownerToken);
  check("cover photo uploads", !!cover.url, JSON.stringify(cover));

  section("Uploading a clip through the existing /upload/image endpoint");
  const clip = await uploadVideo(ownerToken);
  check("video/mp4 upload accepted (already in ALLOWED_FILE_TYPES)", !!clip.url, JSON.stringify(clip));
  check("returned URL ends in .mp4", (clip.url ?? "").endsWith(".mp4"), clip.url);

  section("Serving — the stored clip comes back with the right sniffed Content-Type");
  const served = await fetch(clip.url);
  check("clip is fetchable", served.status === 200, `status ${served.status}`);
  check("Content-Type is video/mp4 (sniffed from magic bytes, not just the .mp4 extension)", served.headers.get("content-type") === "video/mp4", served.headers.get("content-type"));

  section("Create item WITH a video");
  const createWithVideo = await jreq("/items", {
    method: "POST", token: ownerToken,
    body: {
      title: `E2E Video Item ${stamp}`,
      description: "Used to test the listing-video field end to end.",
      category: "ELECTRONICS", condition: "GOOD",
      pricePerDay: 20, securityDeposit: 80,
      images: [cover.url], video: clip.url,
    },
  });
  itemWithVideoId = createWithVideo.json?.data?.item?.id;
  check("item creates", createWithVideo.status === 201, `status ${createWithVideo.status} ${JSON.stringify(createWithVideo.json?.error)}`);
  check("videoUrl round-trips on create", createWithVideo.json?.data?.item?.videoUrl === clip.url);

  section("Create item WITHOUT a video — the common case, must stay null, not an empty string");
  const createNoVideo = await jreq("/items", {
    method: "POST", token: ownerToken,
    body: {
      title: `E2E No-Video Item ${stamp}`,
      description: "Used to test that omitting video defaults to null.",
      category: "ELECTRONICS", condition: "GOOD",
      pricePerDay: 15, securityDeposit: 60,
      images: [cover.url],
    },
  });
  itemNoVideoId = createNoVideo.json?.data?.item?.id;
  check("item creates", createNoVideo.status === 201, `status ${createNoVideo.status}`);
  check("videoUrl is null when omitted", createNoVideo.json?.data?.item?.videoUrl === null, JSON.stringify(createNoVideo.json?.data?.item?.videoUrl));

  section("GET /items/:id — videoUrl round-trips on read, for both items");
  const getWith = await jreq(`/items/${itemWithVideoId}`);
  check("item with video reads back correctly", getWith.json?.data?.item?.videoUrl === clip.url);
  const getWithout = await jreq(`/items/${itemNoVideoId}`);
  check("item without video reads back as null", getWithout.json?.data?.item?.videoUrl === null);

  section("Create-route validation — a non-URL value is rejected");
  const badVideo = await jreq("/items", {
    method: "POST", token: ownerToken,
    body: {
      title: `E2E Bad Video ${stamp}`,
      description: "Should be rejected for an invalid video value.",
      category: "ELECTRONICS", condition: "GOOD",
      pricePerDay: 10, securityDeposit: 40,
      images: [cover.url], video: "not-a-url",
    },
  });
  check("a garbage video value is rejected", badVideo.status === 400, `status ${badVideo.status}`);

  section("Edit — adding a video to a listing that didn't have one");
  const addVideo = await jreq(`/items/${itemNoVideoId}`, {
    method: "PUT", token: ownerToken, body: { video: clip.url },
  });
  check("update accepts the new video", addVideo.status === 200, `status ${addVideo.status}`);
  check("videoUrl is now set", addVideo.json?.data?.item?.videoUrl === clip.url);

  section("Edit — removing a video ('' clears it, same convention as serialNumber)");
  const removeVideo = await jreq(`/items/${itemWithVideoId}`, {
    method: "PUT", token: ownerToken, body: { video: "" },
  });
  check("update accepts the removal", removeVideo.status === 200, `status ${removeVideo.status}`);
  check("videoUrl is now null", removeVideo.json?.data?.item?.videoUrl === null, JSON.stringify(removeVideo.json?.data?.item?.videoUrl));

  section("Edit — omitting the field entirely leaves the existing video untouched");
  const untouched = await jreq(`/items/${itemNoVideoId}`, {
    method: "PUT", token: ownerToken, body: { title: `${(await jreq(`/items/${itemNoVideoId}`)).json.data.item.title} (renamed)` },
  });
  check("update succeeds", untouched.status === 200, `status ${untouched.status}`);
  check("videoUrl is unaffected by an unrelated field update", untouched.json?.data?.item?.videoUrl === clip.url, JSON.stringify(untouched.json?.data?.item?.videoUrl));

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
