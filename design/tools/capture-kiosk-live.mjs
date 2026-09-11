/**
 * D-53 verification against the LIVE kiosk, at the real panel resolution.
 *
 * Drives the Pi's own UI server over Tailscale (http://engirent-kiosk:8080),
 * so this is the real built bundle reading the real /api/state -- not demo
 * mode, which deliberately short-circuits the socket and would show no live
 * occupancy at all.
 *
 * 1080x1920 PORTRAIT. Capturing landscape renders screens.css's "landscape
 * safety net", a layout the kiosk never displays (ACCESS-AND-WORKAROUNDS 2).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.KIOSK_HOST ?? "http://engirent-kiosk:8080";
const OUT = process.env.OUT_DIR ?? "design/screenshots/2026-09-11-d53-live";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await p.goto(`${BASE}/?notetris=1`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.screenshot({ path: join(OUT, "01-main.png") });

// Reach the Locker-status screen the way a student does: the panel sits on
// the IDLE attract loop, so it is tap-to-start FIRST, then the menu action.
// (The first version of this clicked straight for "locker" and silently did
// nothing, because idle has no such control -- the screenshot showed it.)
await p.mouse.click(540, 960);
await p.waitForTimeout(1800);
await p.screenshot({ path: join(OUT, "01b-main.png") });

const lockerBtn = p.getByText(/locker status/i).first();
await lockerBtn.click({ timeout: 8000 }).catch(async () => {
  await p.evaluate(() => {
    const el = [...document.querySelectorAll("button,[role=button]")]
      .find((e) => /locker/i.test(e.textContent ?? ""));
    el?.click();
  });
});
await p.waitForTimeout(2500);
await p.screenshot({ path: join(OUT, "02-lockers.png") });

const read = await p.evaluate(() => {
  const t = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
  return {
    count: t(".lockers-count-n"),
    of: t(".lockers-count-of"),
    label: t(".lockers-count-label"),
    bays: [...document.querySelectorAll(".bay-door")].map((b) => b.textContent.trim().replace(/\s+/g, " ")),
    apiOccupancy: null,
  };
});
read.apiOccupancy = await p.evaluate(async () => {
  const r = await fetch("/api/state");
  const j = await r.json();
  return j.occupancy ?? null;
});
console.log(JSON.stringify(read, null, 2));
await b.close();
