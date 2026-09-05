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

const ADMIN_PAGES = [
  ["login", "/login"],
  ["dashboard", "/dashboard"],
  ["users", "/users"],
  ["items", "/items"],
  ["rentals", "/rentals"],
  ["disputes", "/disputes"],
  ["payments", "/payments"],
  ["verifications", "/verifications"],
  ["id-verifications", "/id-verifications"],
  ["feedback", "/feedback"],
  ["reports", "/reports"],
  ["audit-log", "/audit-log"],
  ["kiosk", "/kiosk"],
  ["health", "/health"],
  ["settings", "/settings"],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let storageState = undefined;

let ok = 0;
const failed = [];

async function capture(surface, base, pages) {
  if (!base) {
    console.log(`  (skipping ${surface} — no URL supplied)`);
    return;
  }
  for (const [vpName, viewport] of VIEWPORTS) {
    const page = await browser.newPage(
      surface === "admin" && storageState ? { viewport, storageState } : { viewport },
    );
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
if (ADMIN && process.env.ADMIN_EMAIL) {
  // The console gates on a token in localStorage, so log in once per context.
  // Captured page-by-page afterwards; the login page itself is captured first,
  // before authenticating, so it is the real unauthenticated screen.
  const loginPage = await browser.newPage({ viewport: VIEWPORTS[0][1] });
  await loginPage.goto(ADMIN + "/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  await loginPage.waitForTimeout(2500);
  await loginPage.fill('input[type="email"], input[name="email"]', process.env.ADMIN_EMAIL);
  await loginPage.fill('input[type="password"], input[name="password"]', process.env.ADMIN_PASSWORD);
  await loginPage.click('button[type="submit"]');
  await loginPage.waitForTimeout(6000);
  console.log("  admin login attempted -> " + loginPage.url());
  storageState = await loginPage.context().storageState();
  await loginPage.close();
}
await capture("admin", ADMIN, ADMIN_PAGES);
await browser.close();

console.log(`\n${ok} captured into ${OUT}`);
if (failed.length) console.log(`FAILED (${failed.length}): ${failed.join(", ")}`);
