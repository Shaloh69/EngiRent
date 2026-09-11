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

await p.route("**/admin/kiosks/lockers", (r) =>
  r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ success: true, data: { lockers: LOCKERS } }) }));

await p.addInitScript(() => localStorage.setItem("admin_token", "probe-token"));
await p.goto("http://localhost:3001/kiosk", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(6000);

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
  const card = await p.evaluate(() => {
    const h = [...document.querySelectorAll("*")].find(
      (e) => e.textContent?.trim() === "Bay state (server)");
    const box = h?.closest("[class*='Card'],[class*='mantine-Paper']");
    return box ? box.textContent.replace(/\s+/g, " ").trim().slice(0, 220) : null;
  });
  read.push({ tab: `Locker ${n}`, selected, card });
  await p.screenshot({ path: join(OUT, `locker-${n}.png`) });
}
console.log(JSON.stringify(read, null, 2));
await b.close();
