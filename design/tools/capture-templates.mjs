/**
 * TEMPLATE reference capture (VISUAL-EVIDENCE.md §1).
 *
 * A TEMPLATE image must show **the actual template screen being borrowed
 * from**, rendered — not a docs page, not a search-results grid. An earlier
 * version of this script captured website chrome (Material 3 docs landing
 * pages, a Dribbble search) and filed it as "templates". That was wrong; those
 * captures now live in design/research/ and satisfy nothing.
 *
 * Each entry below maps a TEMPLATE-LINKS.md row to the specific page of the
 * real template that row cites. Where a template ships a live demo, that demo
 * IS the template rendered, so capturing it is the genuine article.
 *
 *   node design/tools/capture-templates.mjs
 *
 * Viewports follow ENGIRENT-CLAUDE.md §2: 1440x900 for admin/website.
 * Flutter templates have no live demo and must be cloned and run — see
 * design/templates/README.md for what remains outstanding.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.OUT_DIR ?? "design/templates";
const VIEWPORT = { width: 1440, height: 900 };

// design-sparx/mantine-analytics-dashboard — TEMPLATE-LINKS.md Surface 2's
// named primary source, and the only Mantine 7 admin template in the doc.
const MANTINE = "https://mantine-analytics-dashboard.netlify.app";

const REFS = [
  // ── Surface 2, admin console (Mantine) ────────────────────────────────
  ["admin-dashboard", `${MANTINE}/dashboard/analytics`],
  ["admin-reports", `${MANTINE}/dashboard/crm`],
  ["admin-users", `${MANTINE}/apps/customers`],
  ["admin-users-detail", `${MANTINE}/apps/profile`],
  ["admin-items", `${MANTINE}/apps/products`],
  ["admin-rentals", `${MANTINE}/apps/orders`],
  ["admin-rentals-detail", `${MANTINE}/apps/invoices/details`],
  ["admin-payments", `${MANTINE}/apps/invoices`],
  // Queue/inbox pattern — cited by disputes, both verification queues, feedback.
  ["admin-queue-pattern", `${MANTINE}/apps/tasks`],
  ["admin-inbox-pattern", `${MANTINE}/apps/email`],
  ["admin-settings", `${MANTINE}/apps/settings`],
  ["admin-login", `${MANTINE}/auth/signin`],

  // ── Surface 4, public website ─────────────────────────────────────────
  // Live template demos, not docs about them. NOTE: the per-page Preline URLs
  // first tried here (preline.co/templates/agency/*.html) all 404 — three
  // captures came back as the same 404 page and were deleted. Only URLs
  // verified 200 are listed.
  ["web-home", "https://cruip.com/demos/simple/"],
  // Named for what it IS (Cruip's "Tidy" landing demo), not what I hoped
  // it was — an earlier pass filed this as "web-pricing" and it is a
  // landing page. cruip.com/demos/open/ was dropped: it returns Cruip's
  // "there is an issue with the demo" frame error, not the template.
  ["web-landing-tidy", "https://cruip.com/demos/tidy/"],
  ["web-templates-index", "https://preline.co/templates/"],
  ["web-docs", "https://preline.co/docs/index.html"],
  ["web-components-marketing", "https://www.hyperui.dev/components/marketing/banners/"],
  ["web-components-application", "https://www.hyperui.dev/components/application/tables/"],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: VIEWPORT,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
});

let ok = 0;
const failed = [];
for (const [slug, url] of REFS) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
    // Dashboards hydrate charts and tables after first paint.
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(OUT, `${slug}.png`) });
    console.log(`  ok   ${slug}.png`);
    ok++;
  } catch (err) {
    console.log(`  FAIL ${slug} — ${err.message.split("\n")[0].slice(0, 80)}`);
    failed.push(slug);
  }
}
await browser.close();

console.log(`\n${ok}/${REFS.length} template screens captured into ${OUT}`);
if (failed.length) console.log(`FAILED: ${failed.join(", ")}`);
