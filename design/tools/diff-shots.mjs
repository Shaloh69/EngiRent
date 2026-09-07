/**
 * Pixel-diffs two folders of same-named screenshots.
 *
 *   node design/tools/diff-shots.mjs <before-dir> <after-dir>
 *
 * Written for E3.1's token conversion, where the whole verification argument is
 * "this changed exactly what it was supposed to and nothing else". A generated
 * theme that compiles and looks fine can still have moved a colour nobody
 * checked; comparing against the committed BEFORE images is what catches that.
 *
 * Decoding is done in a headless Chromium via canvas rather than pngjs, so this
 * needs nothing beyond the Playwright the repo already has.
 *
 * A non-zero diff is NOT automatically a failure — it is a prompt to look at
 * the two images and say why. Tolerance is 6/255 per channel, which absorbs
 * font-antialiasing jitter between runs while a real colour swap is far larger.
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [BEFORE, AFTER] = process.argv.slice(2);
if (!BEFORE || !AFTER) {
  console.error("usage: node design/tools/diff-shots.mjs <before-dir> <after-dir>");
  process.exit(2);
}

const files = readdirSync(AFTER).filter((f) => f.endsWith(".png")).sort();
const browser = await chromium.launch();
const page = await browser.newPage();

let changed = 0;
for (const f of files) {
  const bPath = join(BEFORE, f);
  if (!existsSync(bPath)) {
    console.log(`  ? ${f.padEnd(26)} no BEFORE image`);
    continue;
  }
  const verdict = await page.evaluate(
    async ([b64a, b64b]) => {
      const load = (b64) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = "data:image/png;base64," + b64;
        });
      const [ia, ib] = await Promise.all([load(b64a), load(b64b)]);
      if (ia.width !== ib.width || ia.height !== ib.height)
        return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
      const data = (img) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, img.width, img.height).data;
      };
      const da = data(ia), db = data(ib);
      let n = 0;
      // Where pixels differ, remember a few so the report can say WHAT changed
      // rather than only how much — "12 px differ" is not actionable,
      // "#ef4444 -> #f37373" is.
      const samples = new Map();
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i] - db[i]) > 6 ||
          Math.abs(da[i + 1] - db[i + 1]) > 6 ||
          Math.abs(da[i + 2] - db[i + 2]) > 6
        ) {
          n++;
          const hex = (d) =>
            "#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
          const k = `${hex(da)} -> ${hex(db)}`;
          samples.set(k, (samples.get(k) ?? 0) + 1);
        }
      }
      const top = [...samples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      return { n, total: ia.width * ia.height, top };
    },
    [readFileSync(bPath).toString("base64"), readFileSync(join(AFTER, f)).toString("base64")],
  );

  if (verdict.size) {
    console.log(`  ! ${f.padEnd(26)} SIZE MISMATCH ${verdict.size}`);
    changed++;
  } else if (verdict.n === 0) {
    console.log(`  = ${f.padEnd(26)} identical`);
  } else {
    changed++;
    const pct = ((verdict.n / verdict.total) * 100).toFixed(3);
    console.log(`  ~ ${f.padEnd(26)} ${verdict.n} px (${pct}%)`);
    for (const [k, c] of verdict.top) console.log(`      ${k}  ×${c}`);
  }
}

await browser.close();
console.log(`\n${changed}/${files.length} screens differ.`);
