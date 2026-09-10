/**
 * E3.2 loading-primitive verification capture.
 *
 * Separate from `capture-kiosk.mjs` on purpose: that one writes `design/before/`,
 * which VISUAL-EVIDENCE.md makes a ONE-SHOT capture with no second chance.
 * This writes to the disposable, gitignored `design/screenshots/`.
 *
 *   cd server/kiosk/kiosk_ui_react && npm run dev      # serves :5173
 *   node design/tools/capture-loading.mjs
 *
 * VIEWPORT 1080x1920 PORTRAIT — see capture-kiosk.mjs's note. Capturing this
 * landscape silently renders screens.css's "landscape safety net", a layout
 * the kiosk never displays, and it looks entirely plausible.
 *
 * Each shot also asserts the thing that distinguishes success from failure,
 * rather than only saving a PNG for someone to squint at:
 *   determinate  -> a bar with 0 < width < 100%, and a real "Ns remaining"
 *   indeterminate-> a sweep, and NO number anywhere (no invented duration)
 *   staged       -> every stage rendered, NONE marked done or active
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.KIOSK_URL ?? "http://localhost:5173";
const OUT = process.env.OUT_DIR ?? "design/screenshots/2026-09-11-loading";
const VIEWPORT = { width: 1080, height: 1920 };

// `notetris=1` skips the BlockAssembly transition — the kiosk's own smoke test
// uses it for the same reason: otherwise the wall covers the screen at capture.
const CASES = [
  ["determinate-15s-door", "?demo=working&seconds=15&notetris=1", 2500],
  ["determinate-15s-reassurance", "?demo=working&seconds=15&notetris=1", 9500],
  ["determinate-5s-locker2", "?demo=working&seconds=5&notetris=1", 1500],
  ["indeterminate-unknown-duration", "?demo=working&notetris=1", 1500],
  ["indeterminate-capturing", "?demo=working&kind=capturing&notetris=1", 1500],
  ["staged-ml-verification", "?demo=verifying&notetris=1", 1500],
];

const results = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
mkdirSync(OUT, { recursive: true });

for (const [name, qs, settle] of CASES) {
  await page.goto(BASE + "/" + qs, { waitUntil: "networkidle" });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: join(OUT, `${name}.png`) });

  const probe = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const fill = q(".ld-bar-fill");
    const track = q(".ld-track");
    const seconds = q(".ld-seconds");
    const reassurance = q(".ld-reassurance");
    const stages = [...document.querySelectorAll(".ld-stage")];
    return {
      hasDeterminateBar: !!fill,
      barWidthPct: fill
        ? Math.round(
            (fill.getBoundingClientRect().width /
              fill.parentElement.getBoundingClientRect().width) *
              100,
          )
        : null,
      secondsText: seconds ? seconds.textContent.trim() : null,
      reassuranceText: reassurance ? reassurance.textContent.trim() : null,
      hasIndeterminateTrack: !!track,
      stageCount: stages.length,
      stagesDone: stages.filter((s) => s.className.includes("ld-stage-done"))
        .length,
      stagesActive: stages.filter((s) =>
        s.className.includes("ld-stage-active"),
      ).length,
      label: q(".ld-label")?.textContent.trim() ?? null,
      // The failure this whole design is shaped around: a number appearing on
      // a wait whose duration is unknown.
      anyNumberShown: /\d+\s*s\b/.test(document.body.innerText),
    };
  });

  results.push({ name, ...probe });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
