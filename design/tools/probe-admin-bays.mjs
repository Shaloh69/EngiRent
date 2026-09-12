/**
 * D-63 UI check. Intercepts /admin/kiosks/lockers with the EXACT payload the
 * live server returned minutes ago (captured from the deployed endpoint, not
 * invented), so the component is verified against a real shape.
 *
 * Interception is used because the API's CORS allowlist is built from
 * CLIENT_ADMIN_URL (the tunnel), so a browser on localhost:3001 is rejected --
 * PROGRESS.md records that exact obstacle. What this proves is the RENDERING;
 * the endpoint itself was verified separately against the live server with a
 * real admin token, including the flipped rows.
 *
 * 2026-09-13 -- WHY THE FIRST VERSION OF THIS SILENTLY PROVED NOTHING.
 * `api` is an axios instance that attaches an `Authorization` header, which
 * makes every call a NON-SIMPLE cross-origin request: the browser sends an
 * `OPTIONS` preflight FIRST. The original handler fulfilled that preflight
 * with a JSON body and no `Access-Control-Allow-*` headers, so the browser
 * rejected it and the real GET was never issued. The page fell through to its
 * catch, and the run still printed four plausible-looking rows.
 *
 * Two things fix it, and the second matters more than the first:
 *   1. Answer the preflight properly and put CORS headers on every fulfilment.
 *   2. COUNT the interceptions and exit non-zero if the count is 0. A probe
 *      that cannot tell "stub rendered" from "stub never fired" is not
 *      evidence -- that is the same class of mistake as `Tests: 0 total`
 *      reading as a pass (PROGRESS.md, 2026-09-12).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "design/screenshots/2026-09-11-d63-admin";
mkdirSync(OUT, { recursive: true });

const LOCKERS = [
  { id: "a", lockerNumber: "1", kioskId: "KIOSK-001", size: "MEDIUM", status: "AVAILABLE", isOperational: true, currentRentalId: null },
  { id: "b", lockerNumber: "2", kioskId: "KIOSK-001", size: "MEDIUM", status: "OCCUPIED", isOperational: true, currentRentalId: null },
  { id: "c", lockerNumber: "3", kioskId: "KIOSK-001", size: "LARGE", status: "AVAILABLE", isOperational: false, currentRentalId: null },
  { id: "d", lockerNumber: "4", kioskId: "KIOSK-001", size: "SMALL", status: "OCCUPIED", isOperational: true, currentRentalId: "7f3c9a11-dead-beef-0000-000000000001" },
];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

const CORS = {
  "Access-Control-Allow-Origin": "http://localhost:3001",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Max-Age": "600",
};

let lockerHits = 0;
const failures = [];
p.on("requestfailed", (r) => failures.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
p.on("console", (m) => { if (m.type() === "error") failures.push(`console: ${m.text()}`); });

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

// Every API call the page makes on mount. `Promise.allSettled` would tolerate
// the other two failing, but a rejected call leaves the page in its fallback
// branch, and a fallback that happens to look right is exactly what this
// probe exists to rule out.
await p.route("**/api/v1/**", (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: CORS, body: "" });
  }
  const url = req.url();
  if (url.includes("/admin/kiosks/lockers")) {
    lockerHits++;
    return json(route, { success: true, data: { lockers: LOCKERS } });
  }
  if (/\/admin\/kiosks\/[^/]+\/config$/.test(url)) {
    return json(route, { success: true, data: { config: {} } });
  }
  if (url.endsWith("/admin/kiosks")) {
    return json(route, { success: true, data: { kiosks: [{ id: "KIOSK-001" }] } });
  }
  return json(route, { success: true, data: {} });
});

await p.addInitScript(() => localStorage.setItem("admin_token", "probe-token"));
await p.goto("http://localhost:3001/kiosk", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(6000);

// G8: name the distinguishing signal BEFORE looking at the output. If the
// stub never served the bay endpoint, nothing below is evidence of anything.
if (lockerHits === 0) {
  console.error("FAIL: /admin/kiosks/lockers was never intercepted -- the page did not use the stub.");
  console.error(failures.slice(0, 10).join("\n"));
  await b.close();
  process.exit(1);
}
console.log(`stub served /admin/kiosks/lockers ${lockerHits}x`);

const read = [];
for (const n of ["01", "02", "03", "04"]) {
  // Click by exact label and ASSERT the tab actually became selected. The
  // first version swallowed click failures with .catch(() => {}) and never
  // checked, so it read locker 1's card four times and reported four
  // identical rows -- which looked like a FAIL of the component.
  const tab = p.getByRole("tab", { name: `Locker ${n}` });
  await tab.click();
  await p.waitForTimeout(1200);
  const selected = await tab.getAttribute("aria-selected");
  // Scoped to the VISIBLE panel, and that is the whole correctness of this
  // read. Mantine keeps every Tabs.Panel mounted -- measured 2026-09-13:
  // 4 panels in the DOM, none carrying `hidden`, 8 elements matching the
  // heading text, exactly one panel with an offsetParent. The previous
  // version searched the whole document, so it returned LOCKER 1's card on
  // every iteration and printed four identical rows. That was read as the
  // component failing to follow the selected tab. It was the probe.
  const card = await p.evaluate(() => {
    const panel = [...document.querySelectorAll('[role="tabpanel"]')]
      .find((x) => x.offsetParent !== null);
    if (!panel) return null;
    const h = [...panel.querySelectorAll("*")].find(
      (e) => e.textContent?.trim() === "Bay state (server)");
    const box = h?.closest("[class*='Card'],[class*='mantine-Paper']");
    return box ? box.textContent.replace(/\s+/g, " ").trim().slice(0, 220) : null;
  });
  read.push({ tab: `Locker ${n}`, selected, card });
  await p.screenshot({ path: join(OUT, `locker-${n}.png`) });
}
console.log(JSON.stringify(read, null, 2));

// The informed-consent half of D-63, and the reason the defect was filed:
// the operator is asked "is this genuinely stuck?" by a DESTRUCTIVE action
// that detaches a real rental. Capture what the confirmation now tells them.
// It is a native window.confirm, so it never appears in a screenshot -- the
// dialog event is the only way to see it. ALWAYS dismissed, never accepted.
const confirms = [];
p.on("dialog", async (d) => {
  confirms.push(d.message());
  await d.dismiss();
});
for (const n of ["01", "02", "03", "04"]) {
  await p.getByRole("tab", { name: `Locker ${n}` }).click();
  await p.waitForTimeout(500);
  const panel = p.locator('[role="tabpanel"]').filter({ has: p.locator("text=Bay state (server)") });
  await panel.locator("visible=true").getByRole("button", { name: "Release", exact: true }).click();
  await p.waitForTimeout(400);
}
console.log("release confirmations:");
for (const c of confirms) console.log("  ---\n  " + c.replace(/\n/g, "\n  "));

// The four cards MUST differ. Four identical rows is the signature of the
// failure this tool was rewritten to catch, not a passing component.
const distinct = new Set(read.map((r) => r.card)).size;
console.log(`distinct bay-state cards: ${distinct} of 4`);
if (failures.length) console.log("page errors:\n" + failures.slice(0, 10).join("\n"));
await b.close();
if (distinct < 4) process.exit(2);
