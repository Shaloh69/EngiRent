/**
 * Render every EngiRent process diagram to a standalone PNG (and SVG).
 *
 *   node render.mjs
 *
 * Mermaid is loaded from a local bundle, so this is repeatable offline. Each
 * plate is drawn on #050F1A — the ground the physical kiosk panel renders —
 * with its sheet number, title, purpose and the source files it was derived
 * from baked in, so a single PNG stands on its own in a document.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { all, CLASSDEFS } from "./diagrams.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? join(HERE, "..", "..", "docs", "diagrams"));
const MERMAID = readFileSync(join(HERE, ".cache", "mermaid.min.js"), "utf8");

mkdirSync(OUT, { recursive: true });

/** classDefs are declared once here, not in each diagram, so they cannot drift. */
function withClasses(code) {
  return code.trimEnd().startsWith("stateDiagram") ? code : code + "\n" + CLASSDEFS;
}

const SHELL = (d) => `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  html,body{margin:0;background:#02080E;}
  #plate{
    background:#050F1A;
    border:1px solid #1B3347;
    padding:34px 38px 26px;
    display:inline-block;
    min-width:760px;
    font-family:"IBM Plex Sans",system-ui,sans-serif;
  }
  .hdr{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
       font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.15em;
       text-transform:uppercase;color:#5E86A8;margin-bottom:10px;}
  .num{background:#E8F0F7;color:#050F1A;font-weight:600;padding:2px 8px;border-radius:2px;letter-spacing:.08em;}
  .lane{color:#4DA3E8;font-weight:600;}
  h1{font-family:"Archivo",sans-serif;font-weight:600;font-size:30px;line-height:1.12;
     letter-spacing:-.02em;color:#E8F0F7;margin:0 0 8px;max-width:1100px;}
  .purpose{font-size:15px;line-height:1.55;color:#A8C3DA;margin:0 0 6px;max-width:1100px;}
  .rule{height:1px;background:#17293A;margin:18px 0 4px;}
  .ftr{font-family:"IBM Plex Mono",monospace;font-size:11px;line-height:1.6;
       color:#47637C;margin-top:16px;border-top:1px solid #17293A;padding-top:10px;
       display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;}
  .brand{color:#4DA3E8;font-weight:500;letter-spacing:.12em;}
  .mer{margin-top:6px;}
  .mermaid{display:flex;justify-content:center;}
  .mermaid svg{max-width:none !important;height:auto;}
</style></head>
<body>
<div id="plate">
  <div class="hdr"><span class="num">${d.num}</span><span class="lane">${d.lane}</span></div>
  <h1>${d.title}</h1>
  <p class="purpose">${d.purpose}</p>
  <div class="rule"></div>
  <div class="mer"><pre class="mermaid">${withClasses(d.code)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</pre></div>
  <div class="ftr">
    <span>DERIVED FROM &nbsp; ${d.source}</span>
    <span class="brand">ENGIRENT · UCLM · 2026-09-12</span>
  </div>
</div>
<script>${MERMAID}</script>
<script>
  window.__rendered = false;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
    flowchart: { htmlLabels: true, curve: "basis", nodeSpacing: 46, rankSpacing: 58, padding: 14 },
    themeVariables: {
      background: "#050F1A",
      primaryColor: "#10293D",
      primaryTextColor: "#E8F0F7",
      primaryBorderColor: "#31506B",
      lineColor: "#5E86A8",
      secondaryColor: "#0D2131",
      tertiaryColor: "#0A1B29",
      clusterBkg: "#08192E",
      clusterBorder: "#26445E",
      edgeLabelBackground: "#0A1B29",
      titleColor: "#8FB6D6",
      fontSize: "15px"
    }
  });
  (async () => {
    await document.fonts.ready;
    await mermaid.run({ querySelector: ".mermaid" });
    document.querySelectorAll(".mermaid svg").forEach((svg) => {
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width) return;
      svg.style.maxWidth = "none";
      svg.style.width = vb.width + "px";
      svg.style.height = vb.height + "px";
      svg.setAttribute("width", vb.width);
      svg.setAttribute("height", vb.height);
    });
    window.__rendered = true;
  })().catch(e => { window.__error = String(e && e.message || e); });
</script>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 7000, height: 2400 },
  deviceScaleFactor: 2,
});

const results = [];
for (const d of all) {
  await page.setContent(SHELL(d), { waitUntil: "load" });
  try {
    await page.waitForFunction(() => window.__rendered || window.__error, null, { timeout: 45000 });
  } catch {
    /* fall through to the error read below */
  }
  const err = await page.evaluate(() => window.__error || null);
  if (err) {
    console.log(`FAIL  ${d.file}  ${err}`);
    results.push({ file: d.file, ok: false, err });
    continue;
  }

  const plate = page.locator("#plate");
  const box = await plate.boundingBox();
  await page.setViewportSize({
    width: Math.max(900, Math.min(8000, Math.ceil(box.width) + 40)),
    height: Math.max(600, Math.min(16000, Math.ceil(box.height) + 40)),
  });
  await page.waitForTimeout(120);

  const png = join(OUT, `${d.file}.png`);
  await plate.screenshot({ path: png, scale: "device" });

  const svg = await page.evaluate(() => {
    const s = document.querySelector(".mermaid svg");
    return s ? s.outerHTML : null;
  });
  if (svg) writeFileSync(join(OUT, `${d.file}.svg`), svg, "utf8");

  const final = await plate.boundingBox();
  console.log(
    `OK    ${d.file}.png  ${Math.round(final.width)}x${Math.round(final.height)} css · 2x`,
  );
  results.push({ file: d.file, ok: true, w: final.width, h: final.height });
}

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} rendered → ${OUT}`);
if (bad.length) {
  console.log("FAILED: " + bad.map((b) => b.file).join(", "));
  process.exitCode = 1;
}
