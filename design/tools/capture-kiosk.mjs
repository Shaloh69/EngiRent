/**
 * Kiosk BEFORE-image capture (E0.5).
 *
 * The kiosk Pi (`engirent-kiosk`) is frequently offline and was inaccessible
 * when these were captured. The workaround, per the user's instruction, is to
 * run the kiosk's own React UI locally in Vite dev mode and drive it with the
 * `?demo=<screen>` parameter that already exists in `useKioskState.ts` —
 * written for exactly this ("local design work and screenshot verification
 * without a running Flask/Socket.IO backend").
 *
 *   cd server/kiosk/kiosk_ui_react && npm run dev      # serves :5173
 *   node design/tools/capture-kiosk.mjs
 *
 * WHAT THIS DOES AND DOES NOT PROVE
 *   Does:     layout, type scale, colour, touch-target sizing, per-screen
 *             composition at the real kiosk viewport.
 *   Does NOT: socket-driven state transitions from the real Pi, GPIO/relay
 *             behaviour, or per-locker actuation timing. Those need hardware
 *             and stay unverified until the Pi is reachable.
 *
 * VIEWPORT: 1080x1920 — PORTRAIT. The panel is a 1920x1080 touchscreen mounted
 * rotated. This is not a guess: `theme.css` line 14 states "PORTRAIT. This is a
 * vertical screen (1080x1920)", and both stylesheets are explicitly
 * "portrait-first", sizing everything from `vmin` (the SHORT edge).
 *
 * Capturing this landscape is a real trap — `screens.css` has an
 * `@media (orientation: landscape)` block described as a "landscape safety net"
 * so "a bench test on a laptop shouldn't render an unusable page". A landscape
 * capture therefore renders a fallback the kiosk NEVER displays, and looks
 * entirely plausible while doing so. Override only with good reason.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.KIOSK_URL ?? "http://localhost:5173";
const OUT = process.env.OUT_DIR ?? "design/before";
const VIEWPORT = {
  width: Number(process.env.KIOSK_W ?? 1080),
  height: Number(process.env.KIOSK_H ?? 1920),
};

// Every member of the `Screen` union in types.ts, plus the offline overlay,
// which is a distinct failure mode layered over whatever screen is active.
const SCREENS = [
  ["idle", "?demo=idle"],
  ["main", "?demo=main"],
  ["how", "?demo=how"],
  ["catalogue", "?demo=catalogue"],
  ["lockers", "?demo=lockers"],
  ["face", "?demo=face"],
  ["verifying", "?demo=verifying"],
  ["success", "?demo=success"],
  ["error", "?demo=error"],
  // Vestigial from the pre-2026-09-03 reversed QR flow (the kiosk used to scan
  // the phone). Captured anyway: a BEFORE image is one-shot, and E0.1 has not
  // yet ruled on delete-vs-keep-flagged.
  ["qr-DEAD", "?demo=qr"],
  ["confirm-DEAD", "?demo=confirm"],
  // Offline overlay forced on top of the main screen.
  ["offline", "?demo=main&offline=1"],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

let ok = 0;
const failures = [];

for (const [slug, query] of SCREENS) {
  const url = `${BASE}/${query}&notetris=1`; // notetris=1 skips the boot animation
  const file = join(OUT, `kiosk-${slug}.png`);
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    // Framer Motion entrance animations settle well under a second; this is
    // deliberately generous rather than racing them.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: file });
    console.log(`  ✓ kiosk-${slug}.png`);
    ok++;
  } catch (err) {
    console.log(`  ✗ kiosk-${slug} — ${err.message.split("\n")[0]}`);
    failures.push(slug);
  }
}

await browser.close();

console.log(`\n${ok}/${SCREENS.length} captured into ${OUT} at ${VIEWPORT.width}x${VIEWPORT.height}`);
if (failures.length) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
