import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
const svg = process.argv[2], out = process.argv[3];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2 });
// Load the .svg FILE directly — no wrapper page, no injected CSS.
await p.goto(pathToFileURL(svg).href);
await p.waitForTimeout(600);
const info = await p.evaluate(() => {
  const s = document.querySelector("svg");
  const t = document.querySelectorAll("text");
  const fo = document.querySelectorAll("foreignObject");
  let empty = 0;
  t.forEach(n => { if (!n.textContent.trim()) empty++; });
  return { w: s?.getAttribute("width"), h: s?.getAttribute("height"),
           texts: t.length, emptyTexts: empty, foreignObjects: fo.length,
           bgFill: document.querySelector("svg > rect")?.getAttribute("fill") ?? null };
});
console.log(JSON.stringify(info));
await p.screenshot({ path: out, clip: { x: 0, y: 0, width: 1400, height: 1200 } });
await b.close();
