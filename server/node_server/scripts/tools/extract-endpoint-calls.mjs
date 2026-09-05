// Static extractor: which API paths does each e2e suite actually call?
// Method per docs/PROGRESS.md — map coverage from what the suites CALL,
// never from their titles. Anything this cannot resolve statically is
// reported as UNRESOLVED rather than silently dropped.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2];
const files = readdirSync(DIR)
  .filter((f) => /^e2e-.*\.mjs$/.test(f) && f !== "e2e-all.mjs")
  .sort();

// `${x}` / ${x} inside a template literal becomes a route param placeholder.
const normalise = (p) =>
  p
    .replace(/\$\{[^}]*\}/g, ":p")
    .replace(/\/\d+(?=\/|$)/g, "/:p")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "") || "/";

const results = {};
const unresolved = {};

for (const f of files) {
  const src = readFileSync(join(DIR, f), "utf8");
  const hits = new Set();
  const misses = new Set();

  // jreq("/path", { method: "POST" ... })  |  jreq(`/path`, {...})
  for (const m of src.matchAll(
    /\bjreq\(\s*(["'`])([^"'`]*)\1\s*(?:,\s*\{([^}]*)\})?/g,
  )) {
    const path = m[2];
    const opts = m[3] || "";
    const method = (opts.match(/method\s*:\s*["'`](\w+)/) || [, "GET"])[1];
    if (path.startsWith("/")) hits.add(`${method.toUpperCase()} ${normalise(path)}`);
    else misses.add(`jreq(${path})`);
  }

  // call("METHOD", "/path", token)
  for (const m of src.matchAll(
    /\bcall\(\s*["'`](\w+)["'`]\s*,\s*(["'`])([^"'`]*)\2/g,
  )) {
    if (m[3].startsWith("/")) hits.add(`${m[1].toUpperCase()} ${normalise(m[3])}`);
  }

  // raw fetch(`${API}/path`, { method })
  for (const m of src.matchAll(
    /fetch\(\s*`\$\{API[^}]*\}([^`]*)`\s*,?\s*(?:\{([\s\S]{0,160}?)\})?/g,
  )) {
    const path = m[1];
    const method = (String(m[2] || "").match(/method\s*:\s*["'`](\w+)/) || [, "GET"])[1];
    if (path.startsWith("/")) hits.add(`${method.toUpperCase()} ${normalise(path)}`);
  }
  for (const m of src.matchAll(/fetch\(\s*API\s*\+\s*(\w+)/g)) {
    misses.add(`fetch(API + ${m[1]}) — path is a variable`);
  }

  results[f] = [...hits].sort();
  if (misses.size) unresolved[f] = [...misses];
}

const out = { results, unresolved };
writeFileSync(process.argv[3], JSON.stringify(out, null, 2));

for (const [f, paths] of Object.entries(results)) {
  console.log(`\n### ${f}  (${paths.length})`);
  for (const p of paths) console.log("  " + p);
}
if (Object.keys(unresolved).length) {
  console.log("\n\n### UNRESOLVED — needs reading by hand");
  for (const [f, ms] of Object.entries(unresolved))
    for (const m of ms) console.log(`  ${f}: ${m}`);
}
