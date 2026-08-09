// Seeds a few visible feedback rows for a screenshot pass, then leaves them
// (unlike the e2e script, which cleans up after itself) — these are meant to
// be looked at, not torn down immediately. Run once, screenshot, then clean
// up manually via the admin console or a follow-up prisma script.
import { PrismaClient } from "@prisma/client";
import { deflateSync } from "node:zlib";

const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";
const prisma = new PrismaClient();

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
function makePng(w = 300, h = 180) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) {
      const bar = y < 40;
      if (bar) raw.push(220, 60, 60);
      else raw.push(240, 240, 245);
    }
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

async function jreq(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${path}`, { method: opts.method ?? "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return res.json();
}
async function submitWithFile(token, fields, png) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (png) fd.append("file", new Blob([png], { type: "image/png" }), "screenshot.png");
  const res = await fetch(`${API}/feedback`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  return res.json();
}

const stamp = Date.now();
const student = {
  email: `demo.feedback.${stamp}@uclm.edu.ph`, studentId: `DFB-${stamp}`,
  firstName: "Allan", lastName: "Mondejar", phoneNumber: "09171234599", password: "Demo@2026!",
};

const reg = await jreq("/auth/register", { method: "POST", body: student });
const token = reg.data.tokens.accessToken;

const r1 = await submitWithFile(token, {
  category: "BUG", body: "The rental detail screen shows the wrong due date after extending a rental — it still shows the original end date even though the extension went through.",
  appVersion: "1.5.2+15", device: "android", screen: "RentalDetailScreen",
});
const r2 = await submitWithFile(token, {
  category: "PAYMENT_PROBLEM", body: "Paid through GCash via the PayMongo checkout, got the success screen, but my rental still shows AWAITING_DEPOSIT ten minutes later.",
  appVersion: "1.5.2+15", device: "iOS", screen: "PaymentWebViewScreen",
}, makePng());
const r3 = await submitWithFile(token, {
  category: "KIOSK_PROBLEM", body: "Scanned the QR at kiosk-1, face verification succeeded (I heard the beep), but locker 3 never actually unlocked. Had to ask a friend to let me back in the building.",
  appVersion: "1.5.2+15", kioskId: "kiosk-1",
});
const r4 = await submitWithFile(token, {
  category: "SUGGESTION", body: "Would be great to have a favourites/saved list for items so I don't have to keep searching for the same calculator every week.",
  appVersion: "1.5.2+15",
});

console.log("seeded:", [r1, r2, r3, r4].map((r) => r.data?.feedback?.id));
console.log("student:", student.email);
await prisma.$disconnect();
