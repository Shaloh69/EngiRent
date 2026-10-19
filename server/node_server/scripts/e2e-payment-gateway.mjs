/**
 * P2 — the main API's PayMongo path through the payment gateway, on a RUNNING
 * API and a RUNNING gateway (SPEC-PAYMENT-GATEWAY.md §3, §6). Real HTTP, a real
 * PayMongo sandbox checkout; no mocks.
 *
 *   node scripts/e2e-payment-gateway.mjs
 *
 * Env:
 *   API_BASE_URL       the API (…/api/v1), configured PAYMENT_MODE=PAYMONGO,
 *                      PAYMENT_GATEWAY=sandbox
 *   GATEWAY_TOKEN      the sandbox gateway's token (this suite signs gateway
 *                      events with it, exactly as the gateway does)
 *   ADMIN_EMAIL / ADMIN_PASSWORD, RENTER_EMAIL / RENTER_PASSWORD,
 *   ITEM_ID            a listed item the renter does not own
 *   PAY_URL_FILE       optional: the checkout URL is written here, and the
 *                      suite then waits up to PAY_WAIT_S (default 420) for
 *                      someone to pay it with a PayMongo TEST card. Without it,
 *                      the "paid" half is skipped (reported, never passed).
 *   RATE_LIMIT_BYPASS_SECRET (optional)
 *
 * Never point this at a LIVE gateway: it refuses unless the API says testMode.
 *
 * The assertions
 * --------------
 *  1. POST /payments creates a REAL sandbox checkout (checkout.paymongo.com),
 *     testMode true, through the gateway (the API holds no PayMongo key).
 *  2. Forged gateway events are refused: no signature, another token, older
 *     than 5 minutes, a body changed after signing, a live-mode event.
 *  3. **The control:** a correctly signed "paid" event for the UNPAID checkout
 *     does not confirm anything: the API asks PayMongo, which says open, and
 *     the transaction is still PENDING afterwards.
 *  4. After a real test-card payment the transaction becomes COMPLETED by
 *     itself (the poller asks the gateway; nobody calls the API).
 *  5. The same signed event again changes nothing (idempotent).
 *  6. An admin refund goes to PayMongo through the gateway: REFUNDED, or, when
 *     PayMongo refuses (funds not yet available), the row stays COMPLETED.
 *  7. Admin system health reports the sandbox gateway awake, TEST mode.
 *  8. Receiving institutions come from the gateway (D-21: the real bank list).
 */
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";

const API = process.env.API_BASE_URL ?? "http://localhost:5000/api/v1";
const BYPASS = process.env.RATE_LIMIT_BYPASS_SECRET ?? "";
const TOKEN = process.env.GATEWAY_TOKEN ?? "";
const PAY_URL_FILE = process.env.PAY_URL_FILE ?? "";
const PAY_WAIT_S = Number(process.env.PAY_WAIT_S ?? 420);

let pass = 0;
let fail = 0;
let inconclusive = 0;
const failures = [];
const skipped = [];

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
function skip(name, why) {
  inconclusive++;
  skipped.push(`${name} — ${why}`);
  console.log(`  SKIP  ${name} — ${why}`);
}
const section = (t) => console.log(`\n=== ${t} ===`);

async function jreq(path, { method = "GET", token, body, raw, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(BYPASS ? { "X-RateLimit-Bypass": BYPASS } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* reported through status */
  }
  return { status: res.status, json };
}

async function login(email, password) {
  const r = await jreq("/auth/login", { method: "POST", body: { email, password } });
  return r.json?.data?.tokens?.accessToken ?? null;
}

const sign = (token, ts, body) => crypto.createHmac("sha256", token).update(`${ts}.${body}`).digest("hex");
function sendEvent(body, { token = TOKEN, ts = Date.now(), sig } = {}) {
  return jreq("/payments/gateway-event", {
    method: "POST",
    raw: body,
    headers: { "X-Gateway-Timestamp": String(ts), ...(sig === null ? {} : { "X-Gateway-Signature": sig ?? sign(token, ts, body) }) },
  });
}
const status = async (token, txId) => (await jreq(`/payments/status/${txId}`, { token })).json?.data?.status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`payment gateway (P2) — against ${API}\n`);
  if (TOKEN.length < 32) {
    console.log("GATEWAY_TOKEN is not set (32+ chars): cannot sign gateway events. Stopping.");
    process.exit(2);
  }
  const admin = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const renter = await login(process.env.RENTER_EMAIL, process.env.RENTER_PASSWORD);
  check("admin and renter can log in", Boolean(admin && renter));
  if (!admin || !renter) return finish();

  section("1. a real sandbox checkout, through the gateway");
  const day = 86_400_000;
  const rental = await jreq("/rentals", {
    method: "POST",
    token: renter,
    body: { itemId: process.env.ITEM_ID, startDate: new Date(Date.now() + day).toISOString(), endDate: new Date(Date.now() + 3 * day).toISOString() },
  });
  const rentalId = rental.json?.data?.rental?.id;
  check("booking created (PENDING)", rental.status === 201 && rental.json?.data?.rental?.status === "PENDING", `${rental.status} ${JSON.stringify(rental.json)?.slice(0, 200)}`);
  if (!rentalId) return finish();

  const pay = await jreq("/payments", { method: "POST", token: renter, body: { rentalId, type: "RENTAL_PAYMENT" } });
  const d = pay.json?.data ?? {};
  const txId = d.transaction?.id;
  let host = "";
  try {
    host = new URL(d.paymentUrl).host;
  } catch {
    /* reported below */
  }
  check("POST /payments -> PAYMONGO with a checkout.paymongo.com URL", pay.status === 201 && d.paymentMode === "PAYMONGO" && host === "checkout.paymongo.com", `${pay.status} ${JSON.stringify(pay.json)?.slice(0, 300)}`);
  check("testMode is true (sandbox gateway)", d.testMode === true);
  if (d.testMode !== true || !txId || !d.transaction?.paymongoCheckoutId) {
    console.log("  Not a sandbox checkout: stopping before anything is paid.");
    return finish();
  }
  check("the transaction records paymentEnv=sandbox", d.transaction.paymentEnv === "sandbox", String(d.transaction.paymentEnv));
  const checkoutId = d.transaction.paymongoCheckoutId;
  const event = JSON.stringify({ mode: "sandbox", eventId: "evt_e2e", type: "checkout_session.payment.paid", livemode: false, checkoutId });

  section("2. forged gateway events are refused");
  check("no signature -> 401", (await sendEvent(event, { sig: null })).status === 401);
  check("another token -> 401", (await sendEvent(event, { token: "x".repeat(48) })).status === 401);
  check("older than 5 minutes -> 401", (await sendEvent(event, { ts: Date.now() - 6 * 60_000 })).status === 401);
  {
    const ts = Date.now();
    const r = await sendEvent(event.replace(checkoutId, "cs_tampered000"), { ts, sig: sign(TOKEN, ts, event) });
    check("body changed after signing -> 401", r.status === 401, String(r.status));
  }
  {
    const live = event.replace('"mode":"sandbox"', '"mode":"live"');
    const r = await sendEvent(live);
    check("a live-mode event (no live gateway here) -> 401", r.status === 401, String(r.status));
  }

  section("3. the control: a valid 'paid' event for an UNPAID checkout confirms nothing");
  {
    const r = await sendEvent(event);
    check("signed event accepted, outcome 'open' (PayMongo was asked)", r.status === 200 && r.json?.outcome === "open", `${r.status} ${JSON.stringify(r.json)}`);
    check("transaction still PENDING", (await status(renter, txId)) === "PENDING");
  }

  section("4. a real test-card payment confirms by itself (poller -> gateway -> PayMongo)");
  let paid = false;
  if (!PAY_URL_FILE) {
    skip("paid -> COMPLETED", "PAY_URL_FILE not set: nobody pays the checkout in this run");
  } else {
    writeFileSync(PAY_URL_FILE, d.paymentUrl + "\n");
    console.log(`  waiting up to ${PAY_WAIT_S} s for the checkout to be paid with a TEST card…`);
    const t0 = Date.now();
    let s = "PENDING";
    while (Date.now() - t0 < PAY_WAIT_S * 1000) {
      s = await status(renter, txId);
      if (s === "COMPLETED") break;
      await sleep(3000);
    }
    paid = s === "COMPLETED";
    check(`COMPLETED without anyone calling the API (${Math.round((Date.now() - t0) / 1000)} s after the URL was published)`, paid, `last status ${s}`);
  }

  section("5. the same event again changes nothing");
  if (paid) {
    const r = await sendEvent(event);
    check("outcome 'skip', still COMPLETED", r.status === 200 && r.json?.outcome === "skip" && (await status(renter, txId)) === "COMPLETED", JSON.stringify(r.json));
  } else skip("replay after payment", "not paid in this run");

  section("6. an admin refund goes to PayMongo through the gateway");
  // PayMongo only refunds from the AVAILABLE balance: a payment made minutes
  // ago is refused with 400 available_balance_insufficient (seen on the first
  // P2 run, 2026-10-19). Both outcomes are acceptable; what is never acceptable
  // is the row marked REFUNDED when PayMongo did not refund.
  if (paid) {
    const r = await jreq(`/payments/${txId}/refund`, { method: "POST", token: admin });
    const after = await status(renter, txId);
    if (r.status === 200) {
      check("refund through the gateway -> REFUNDED", after === "REFUNDED", `status ${after}`);
    } else {
      console.log(`  NOTE  PayMongo refused the refund (${r.status}: ${r.json?.message ?? ""}); usually the funds are not yet available`);
      check("a refused refund leaves the payment COMPLETED (never marked refunded)", after === "COMPLETED", `status ${after}`);
    }
  } else skip("refund", "not paid in this run");

  section("7. admin system health");
  {
    const r = await jreq("/admin/health", { token: admin });
    const checks = r.json?.data?.checks ?? r.json?.data ?? [];
    const gw = (Array.isArray(checks) ? checks : []).find((c) => /Payment gateway/.test(c?.name ?? ""));
    check("reports the sandbox gateway awake, TEST mode", Boolean(gw?.ok) && /TEST mode/.test(gw?.detail ?? ""), JSON.stringify(gw ?? r.json)?.slice(0, 300));
  }

  section("8. receiving institutions come from the gateway");
  {
    const r = await jreq("/payments/receiving-institutions?provider=instapay", { token: renter });
    const n = r.json?.data?.institutions?.length ?? 0;
    check(`instapay banks listed (${n})`, r.status === 200 && n > 10, String(r.status));
  }

  finish();
})().catch((e) => {
  console.error(e);
  fail++;
  finish();
});

function finish() {
  console.log(`\n${pass} passed, ${fail} failed, ${inconclusive} skipped`);
  for (const f of failures) console.log(`  FAILED: ${f}`);
  for (const s of skipped) console.log(`  SKIPPED: ${s}`);
  process.exit(fail ? 1 : 0);
}
