// Captures what each of the four surfaces RENDERED before E3.1's generator was
// applied, into design/tokens/baseline.json.
//
//   node design/tokens/snapshot.mjs [git-ref]     (default: the E3.1 base commit)
//
// Why a committed snapshot rather than parsing the live files: once a surface
// starts consuming the generated tokens, its hand-written theme file no longer
// contains the values, so "compare the generator against the current file" stops
// working exactly when the first surface is converted. The baseline is the
// fixed point the fidelity check needs — it says what the product looked like
// on 2026-09-08, and it does not move when a surface is converted.
//
// Re-run this ONLY to re-derive the baseline from an earlier ref. Never re-run
// it to make a failing fidelity check pass: that would be recording the change
// as the baseline, which defeats the entire check.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib.mjs";

// The commit E3.1's generator work starts from — the last commit in which all
// four surfaces still carried hand-written values.
const REF = process.argv[2] ?? "31f9e74";

function show(path) {
  return execFileSync("git", ["show", `${REF}:${path}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

const norm = (h) => String(h).trim().toLowerCase();

function cssVars(body, names, prefix) {
  const out = {};
  for (const n of names) {
    const m = new RegExp(`--${prefix}${n}:\\s*([^;]+);`).exec(body);
    if (m) out[n] = norm(m[1]);
  }
  return out;
}

function block(css, selector) {
  const m = new RegExp(`${selector}[^{]*\\{([^}]*)\\}`, "m").exec(css);
  return m ? m[1] : "";
}

// ── kiosk ───────────────────────────────────────────────────────────────────
const kioskCss = show("server/kiosk/kiosk_ui_react/src/theme.css");
const kiosk = cssVars(
  block(kioskCss, "^:root"),
  ["bg", "surf", "surf2", "border", "brand", "gold", "coral", "emerald", "warn", "danger", "ink", "ink2", "ink3"],
  "",
);

// ── website ─────────────────────────────────────────────────────────────────
const webCss = show("client/web/styles/globals.css");
const webNames = ["bg", "surface", "soft", "border", "ink", "muted", "primary", "secondary", "accent"];
const web = {
  light: cssVars(block(webCss, "^:root"), webNames, "brand-"),
  dark: cssVars(block(webCss, "^\\.dark"), webNames, "brand-"),
};

// ── admin ───────────────────────────────────────────────────────────────────
const adminCss = show("client/admin/src/app/globals.css");
const adminNames = ["bg", "surface", "surface-soft", "border", "ink", "muted", "primary", "secondary", "accent", "danger"];
const admin = {
  light: cssVars(block(adminCss, "^:root"), adminNames, "color-"),
  dark: cssVars(block(adminCss, '^\\[data-mantine-color-scheme="dark"\\]'), adminNames, "color-"),
};

// ── flutter ─────────────────────────────────────────────────────────────────
const dartSrc = show("client/flutter_app/lib/core/constants/app_colors.dart");
const flutter = {};
for (const m of dartSrc.matchAll(
  /Color (\w+) = Color\(0x(?:FF|ff)([0-9a-fA-F]{6})\)/g,
)) {
  flutter[m[1]] = `#${norm(m[2])}`;
}

const baseline = {
  $note:
    "What the four surfaces rendered BEFORE E3.1's generator was applied. Captured by design/tokens/snapshot.mjs from git. This is the fixed point design/tokens/verify.mjs checks the generator against — every difference must be on verify.mjs's DELIBERATE list. Do not regenerate this to silence a failure.",
  $ref: REF,
  $capturedAt: "2026-09-08",
  kiosk,
  web,
  admin,
  flutter,
};

writeFileSync(
  join(REPO_ROOT, "design/tokens/baseline.json"),
  JSON.stringify(baseline, null, 2) + "\n",
  "utf8",
);
console.log(
  `Captured baseline from ${REF}: kiosk ${Object.keys(kiosk).length}, ` +
    `web ${Object.keys(web.light).length}+${Object.keys(web.dark).length}, ` +
    `admin ${Object.keys(admin.light).length}+${Object.keys(admin.dark).length}, ` +
    `flutter ${Object.keys(flutter).length} values.`,
);
