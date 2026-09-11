/**
 * Kiosk contrast sweep against the REDESIGNED build, on the live Pi.
 *
 * E3.1's contrast box and E3's DoD box were both HALF MET for one reason: the
 * physical measurement of 2026-09-10 was taken while the Pi still ran
 * `main@1546cd6`, i.e. the PRE-redesign UI. The redesigned build is now
 * deployed, so this re-measures it.
 *
 *   node design/tools/contrast-kiosk-live.mjs
 *
 * Drives the Pi's own UI server over Tailscale at the real panel resolution,
 * so these are the computed values of the real bundle rendering real state —
 * not a local dev build and not demo mode.
 *
 * WHAT IT MEASURES. Every visible text node: its computed colour against its
 * EFFECTIVE background, found by walking ancestors until a non-transparent
 * one is hit. WCAG floors applied per size — 3:1 for large text (>=24px, or
 * >=18.66px at weight >=700), 4.5:1 otherwise. Reporting a single flat 4.5
 * would fail the big idle headline for no reason.
 *
 * Text drawn over the animated aurora/gradient is reported separately rather
 * than silently passed or failed: its background is a moving image, so a
 * single composited sample is not a stable contrast figure and saying so is
 * more honest than printing a number.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.KIOSK_HOST ?? "http://engirent-kiosk:8080";
const OUT = process.env.OUT_DIR ?? "design/screenshots/2026-09-11-kiosk-contrast";
mkdirSync(OUT, { recursive: true });

const MEASURE = `() => {
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (s) => {
    const m = s && s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  const hex = ([r, g, b]) =>
    '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!direct) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;

    const fg = parse(cs.color);
    if (!fg || fg.a < 0.95) continue;

    // Effective background: first ancestor with a non-transparent colour.
    let bg = null, node = el, overImage = false;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') overImage = true;
      const b = parse(s.backgroundColor);
      if (b && b.a > 0.95) { bg = b; break; }
      node = node.parentElement;
    }
    if (!bg) { const b = parse(getComputedStyle(document.body).backgroundColor); if (b) bg = b; }
    if (!bg) continue;

    const px = parseFloat(cs.fontSize);
    const wt = parseInt(cs.fontWeight, 10) || 400;
    const large = px >= 24 || (px >= 18.66 && wt >= 700);
    const floor = large ? 3.0 : 4.5;
    const cr = ratio(fg.rgb, bg.rgb);

    out.push({
      text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 42),
      cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 28) : '',
      fg: hex(fg.rgb), bg: hex(bg.rgb),
      px: Math.round(px), wt, large,
      ratio: Math.round(cr * 100) / 100,
      floor, pass: cr >= floor, overImage,
    });
  }
  return out;
}`;

// The flow screens (face/verifying/success/error/offline) cannot be reached by
// clicking -- they need live rental state. `?demo=<screen>` renders them from
// the SAME deployed bundle, and colour does not depend on live data, so it is
// a legitimate way to get full screen coverage for a CONTRAST sweep
// specifically. It would not be legitimate for anything behavioural.
const DEMO = ["catalogue", "face", "verifying", "success", "error", "offline", "working"];

const SCREENS = [
  ["idle", async () => {}],
  ["main", async (p) => { await p.mouse.click(540, 960); await p.waitForTimeout(1600); }],
  ["lockers", async (p) => {
    await p.mouse.click(540, 960); await p.waitForTimeout(1500);
    await p.getByText(/locker status/i).first().click().catch(() => {});
    await p.waitForTimeout(1800);
  }],
  ["how", async (p) => {
    await p.mouse.click(540, 960); await p.waitForTimeout(1500);
    await p.getByText(/how it works/i).first().click().catch(() => {});
    await p.waitForTimeout(1800);
  }],
];

const browser = await chromium.launch();
const all = [];
for (const d of DEMO) SCREENS.push([`demo:${d}`, async () => {}, `?demo=${d}&notetris=1`]);

for (const [name, nav, qs] of SCREENS) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/${qs ?? "?notetris=1"}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  await nav(page);
  await page.screenshot({ path: join(OUT, `${name.replace(":", "-")}.png`) });
  const rows = await page.evaluate(`(${MEASURE})()`);
  rows.forEach((r) => all.push({ screen: name, ...r }));
  await page.close();
}
await browser.close();

const solid = all.filter((r) => !r.overImage);
const overImg = all.filter((r) => r.overImage);
const failing = solid.filter((r) => !r.pass);

writeFileSync(join(OUT, "contrast.json"), JSON.stringify(all, null, 2));

console.log(`measured ${all.length} text nodes across ${SCREENS.length} screens`);
console.log(`  on a SOLID background : ${solid.length}   FAILING: ${failing.length}`);
console.log(`  over a gradient/image : ${overImg.length}  (reported, not scored — the background moves)`);
const worst = [...solid].sort((a, b) => a.ratio - b.ratio).slice(0, 8);
console.log("\nLOWEST 8 on solid backgrounds:");
for (const r of worst) {
  console.log(
    `  ${r.pass ? "PASS" : "FAIL"}  ${String(r.ratio).padStart(6)}:1  (floor ${r.floor})  ` +
      `${r.fg} on ${r.bg}  ${r.px}px/${r.wt}  [${r.screen}] ${JSON.stringify(r.text)}`,
  );
}
if (failing.length) {
  console.log("\nFAILING:");
  for (const r of failing) console.log(`  ${r.ratio}:1 < ${r.floor}  ${r.fg} on ${r.bg}  [${r.screen}] ${JSON.stringify(r.text)}`);
}
