/**
 * BEFORE-image capture for the public website and admin console (E0.5).
 *
 * These are the one-shot images: once a screen is touched, its before-image is
 * gone permanently (VISUAL-EVIDENCE.md §1). Captured at BOTH required
 * viewports — 1440x900 and 390x844 — because "a screen with only a desktop
 * capture is FAILED".
 *
 *   WEB_URL=https://... ADMIN_URL=https://... node design/tools/capture-before-web.mjs
 *
 * Cloudflare quick-tunnel hostnames rotate on every restart, so the URLs are
 * env-supplied rather than baked in — read the current ones from
 * startbat-logs/tunnel-*.log on the server PC.
 *
 * NOTE: admin pages behind auth will land on /login and are captured as such,
 * honestly named. They are not the real page and must not be filed as one.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const WEB = process.env.WEB_URL;
const ADMIN = process.env.ADMIN_URL;
const OUT = process.env.OUT_DIR ?? "design/before";

const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
];

const WEB_PAGES = [
  ["home", "/"],
  ["about", "/about"],
  ["pricing", "/pricing"],
  ["docs", "/docs"],
  ["blog", "/blog"],
  ["changelog", "/changelog"],
  ["download", "/download"],
  ["downloading", "/downloading"],
  ["payments-mock", "/payments/mock"],
  ["payments-success", "/payments/success"],
  ["payments-cancel", "/payments/cancel"],
];

// Only the unauthenticated pages are listed. The other 15 admin pages sit
// behind auth and, without credentials, every one of them renders the same
// login redirect — capturing 30 identical images and filing them as distinct
// screens would be worse than admitting the gap. Add them back once an admin
// login is available.
const ADMIN_PAGES = [
  ["login", "/login"],
  ["root-redirect", "/"],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

let ok = 0;
const failed = [];

async function capture(surface, base, pages) {
  if (!base) {
    console.log(`  (skipping ${surface} — no URL supplied)`);
    return;
  }
  for (const [vpName, viewport] of VIEWPORTS) {
    const page = await browser.newPage({ viewport });
    for (const [slug, path] of pages) {
      const file = join(OUT, `${surface}-${slug}-${vpName}.png`);
      try {
        await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3500); // let hydration and fonts settle
        await page.screenshot({ path: file });
        console.log(`  ok   ${surface}-${slug}-${vpName}.png`);
        ok++;
      } catch (err) {
        console.log(`  FAIL ${surface}-${slug}-${vpName} — ${err.message.split("\n")[0].slice(0, 70)}`);
        failed.push(`${surface}-${slug}-${vpName}`);
      }
    }
    await page.close();
  }
}

await capture("web", WEB, WEB_PAGES);
await capture("admin", ADMIN, ADMIN_PAGES);
await browser.close();

console.log(`\n${ok} captured into ${OUT}`);
if (failed.length) console.log(`FAILED (${failed.length}): ${failed.join(", ")}`);
