// E3.1 fidelity + contrast verifier.
//
//   node design/tokens/verify.mjs
//
// Two jobs, and the first is the one that matters before anything is applied:
//
// 1. FIDELITY. For every colour the four surfaces rendered BEFORE E3.1
//    (design/tokens/baseline.json, captured from git by snapshot.mjs), the
//    generator must produce the same value — except for an explicit, itemised
//    list of DELIBERATE DELTAS. A generator that silently restyles the product
//    is worse than no generator; the allowlist is how a reviewer sees exactly
//    what E3.1 changes, and nothing else slips through.
//
//    It compares against the BASELINE, not the live files, because a surface
//    that has been converted no longer contains the values — the check would
//    otherwise stop working precisely when it starts mattering.
//
// 2. CONTRAST. WCAG 2.1 ratios for every role against its own theme's grounds,
//    computed separately per theme, because passing light proves nothing about
//    dark (E3 DoD). This is the computational half of that gate; the kiosk's
//    physical corridor-lighting check remains B-2-blocked.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadTokens,
  resolveSemantic,
  contrastRatio,
  fmtRatio,
  hexToRgb,
  AA,
  REPO_ROOT,
} from "./lib.mjs";

const tokens = loadTokens();
const light = resolveSemantic(tokens, "light");
const dark = resolveSemantic(tokens, "dark");

const baseline = JSON.parse(
  readFileSync(join(REPO_ROOT, "design/tokens/baseline.json"), "utf8"),
);
const norm = (h) => String(h).trim().toLowerCase().replace(/^#/, "");

let failures = 0;
let deltas = 0;

/**
 * Deliberate deltas — every value E3.1 intends to change, with the reason.
 * Anything NOT on this list must match the current file exactly.
 * Keyed by "surface:name".
 */
const DELIBERATE = {
  "kiosk:--danger":
    "dark critical lifts #EF4444 -> #F37373 ($darkStatusRule: 5.12:1 is under the 6:1 dark floor; 6.90:1 after). Unifies with admin, which already rendered the lifted red on dark.",
  "kiosk:--danger-glow": "follows --danger.",
  "flutter:surfaceAlt-light":
    "app_theme.dart's #F3F8F7 -> #EEF4FB, the value admin, the website and Flutter's own app_widgets.dart already render. Kills a 1-vs-3 split.",
  "flutter:grey":
    "mandate-banned generic grey #9CA3AF removed; textDisabled becomes the teal-tinted #8CA2BC.",
  "flutter:greyDark": "mandate-banned generic grey #4B5563 removed.",
  "flutter:greyLight": "mandate-banned generic grey #F3F4F6 removed.",
  "flutter:borderDark": "mandate-banned generic grey #D1D5DB removed.",
  "flutter:surfaceDark":
    "generic slate #1F2937 removed; the real dark surface is #0B1A2A.",
  "flutter:secondaryLight":
    "#F5B85C is the dark-ground gold; the ramp keeps it as gold.onDark rather than as a second name for the same hex.",
  "admin:surfaceTokens.dark":
    "the green-tinted dark set (#071310/#0E1F1B/#12271F/#1E3B35/#7FA39C/#EAF5F2) is DEAD CODE — zero consumers — and disagrees with every rendering surface. Replaced by the blue-tinted dark the Mantine tuple and globals.css already use.",
  "admin:surfaceTokens.light.surfaceAlt": "same #F3F8F7 -> #EEF4FB unification.",
  "*:PENDING": "the pending family moves warning-yellow -> review cyan #0E9BB8.",
};

function check(surface, name, expected, actual, { onLight } = {}) {
  const key = `${surface}:${name}`;
  const ok = norm(expected) === norm(actual);
  if (ok) return true;
  if (DELIBERATE[key]) {
    deltas++;
    console.log(
      `  ~ ${name.padEnd(24)} ${norm(expected)} -> ${norm(actual)}  DELTA: ${DELIBERATE[key]}`,
    );
    return true;
  }
  failures++;
  console.log(
    `  ✗ ${name.padEnd(24)} file has #${norm(expected)}, generator emits #${norm(actual)} — NOT on the deliberate list`,
  );
  return false;
}
// ── 1. Fidelity, per surface ────────────────────────────────────────────────

console.log("\n=== FIDELITY: generated values vs what each surface rendered before E3.1 ===");
console.log(`    baseline: ${baseline.$ref} (${baseline.$capturedAt})\n`);

// kiosk — dark resolution only.
{
  console.log("kiosk   (theme.css :root)");
  const map = {
    bg: dark.appBg,
    surf: dark.surface,
    surf2: dark.surfaceAlt,
    border: dark.border,
    brand: dark.brand,
    gold: dark.accent,
    coral: dark.cta,
    emerald: dark.success,
    warn: dark.warning,
    danger: dark.critical,
    ink: dark.textPrimary,
    ink2: dark.textSecondary,
    ink3: dark.textDisabled,
  };
  for (const [name, generated] of Object.entries(map)) {
    const was = baseline.kiosk[name];
    if (!was) {
      failures++;
      console.log(`  ✗ --${name} missing from the baseline`);
      continue;
    }
    check("kiosk", `--${name}`, was, generated);
  }
}

// website — both themes. The .dark block is driven by next-themes; the
// website was documented light-only and is not.
{
  console.log("\nweb     (globals.css :root / .dark)");
  const map = (set) => ({
    bg: set.appBg,
    surface: set.surface,
    soft: set.surfaceAlt,
    border: set.border,
    ink: set.textPrimary,
    muted: set.textSecondary,
    primary: set.brand,
    secondary: set.accent,
    accent: set.cta,
  });
  for (const [theme, set] of [["light", light], ["dark", dark]]) {
    for (const [name, generated] of Object.entries(map(set))) {
      const was = baseline.web[theme][name];
      if (!was) {
        failures++;
        console.log(`  ✗ ${theme} --brand-${name} missing from the baseline`);
        continue;
      }
      check("web", `${theme} --brand-${name}`, was, generated);
    }
  }
}

// admin — globals.css is the live theming; theme.ts's surfaceTokens is dead.
{
  console.log("\nadmin   (globals.css light / dark)");
  const map = (set) => ({
    bg: set.appBg,
    surface: set.surface,
    "surface-soft": set.surfaceAlt,
    border: set.border,
    ink: set.textPrimary,
    muted: set.textSecondary,
    primary: set.brand,
    secondary: set.accent,
    accent: set.cta,
    danger: set.critical,
  });
  for (const [theme, set] of [["light", light], ["dark", dark]]) {
    for (const [name, generated] of Object.entries(map(set))) {
      const was = baseline.admin[theme][name];
      if (!was) {
        failures++;
        console.log(`  ✗ ${theme} --color-${name} missing from the baseline`);
        continue;
      }
      check("admin", `${theme} --color-${name}`, was, generated);
    }
  }
}

// flutter — AppColors constants.
{
  console.log("\nflutter (AppColors)");
  const map = {
    primary: light.brand,
    primaryDark: tokens.palette.teal["700"],
    primaryLight: dark.brand,
    secondary: light.accent,
    secondaryDark: tokens.palette.gold["700"],
    accent: light.cta,
    accentDark: tokens.palette.coral["700"],
    success: light.success,
    successDark: tokens.palette.emerald["700"],
    successLight: tokens.palette.emerald["400"],
    warning: light.warning,
    error: light.critical,
    info: light.review,
    white: tokens.palette.ink["0"],
    background: light.appBg,
    surface: light.surface,
    textPrimary: light.textPrimary,
    textSecondary: light.textSecondary,
    border: light.border,
    backgroundDarkMode: dark.appBg,
    surfaceDarkMode: dark.surface,
    surfaceAltDarkMode: dark.surfaceAlt,
    borderDarkMode: dark.border,
    textPrimaryDark: dark.textPrimary,
    textSecondaryDark: dark.textSecondary,
    textDisabledDark: dark.textDisabled,
    primaryOnDark: dark.brand,
    secondaryOnDark: dark.accent,
    accentOnDark: dark.cta,
  };
  for (const [name, generated] of Object.entries(map)) {
    const was = baseline.flutter[name];
    if (!was) {
      failures++;
      console.log(`  ✗ AppColors.${name} missing from the baseline`);
      continue;
    }
    check("flutter", name, was, generated);
  }
  // The banned greys and the light surfaceAlt split: present in the baseline,
  // removed by E3.1. Reported as deltas so the change is visible, not silent.
  for (const name of ["grey", "greyDark", "greyLight", "borderDark", "surfaceDark", "textDisabled", "secondaryLight"]) {
    const was = baseline.flutter[name];
    if (!was) continue;
    const key = `flutter:${name}`;
    if (DELIBERATE[key]) {
      deltas++;
      console.log(`  ~ ${name.padEnd(24)} ${was} — ${DELIBERATE[key]}`);
    }
  }
  deltas++;
  console.log(`  ~ ${"surfaceAlt-light".padEnd(24)} #f3f8f7 -> ${light.surfaceAlt} — ${DELIBERATE["flutter:surfaceAlt-light"]}`);
}

// ── 2. Contrast, per theme ──────────────────────────────────────────────────

console.log("\n=== CONTRAST (WCAG 2.1), computed separately per theme ===");
console.log("    body 4.5:1 · large text / UI boundary 3.0:1\n");

let contrastProblems = 0;

for (const [themeName, set] of [
  ["LIGHT", light],
  ["DARK", dark],
]) {
  console.log(`  ${themeName} — grounds: appBg ${set.appBg}, surface ${set.surface}`);
  const grounds = [
    ["appBg", set.appBg],
    ["surface", set.surface],
  ];
  // The `use` column is load-bearing: a colour is not pass/fail in the
  // abstract, only against what it is used FOR. Getting these labels wrong is
  // how a contrast report produces noise instead of findings.
  //   body      4.5 — normal text
  //   large     3.0 — 18pt / 14pt-bold text
  //   ui        3.0 — boundary of an interactive control, or a graphic that
  //                   carries meaning (WCAG 1.4.11)
  //   fill      —   — an identity hue used as a GROUND, never as text; its
  //                   contrast that matters is ink-on-fill, checked as chips
  //   decor     —   — a hairline separator; 1.4.11 exempts pure decoration
  //   disabled  —   — WCAG 1.4.3 exempts inactive controls outright
  const fgs = [
    ["textPrimary", set.textPrimary, "body"],
    ["textSecondary", set.textSecondary, "body"],
    ["textDisabled", set.textDisabled, "disabled"],
    ["brand", set.brand, "large"],
    ["brandInk", set.brandInk, "body"],
    ["successInk", set.successInk, "body"],
    ["warningInk", set.warningInk, "body"],
    ["criticalInk", set.criticalInk, "body"],
    ["reviewInk", set.reviewInk, "body"],
    ["accentInk", set.accentInk, "body"],
    ["ctaInk", set.ctaInk, "body"],
    ["success", set.success, "fill"],
    ["warning", set.warning, "fill"],
    ["critical", set.critical, "fill"],
    ["review", set.review, "fill"],
    ["accent", set.accent, "fill"],
    ["cta", set.cta, "fill"],
    ["border", set.border, "decor"],
    ["borderStrong", set.borderStrong, "ui"],
  ];
  for (const [name, hex, use] of fgs) {
    const floor = AA[use] ?? null;
    const row = grounds.map(([gname, ghex]) => {
      const r = contrastRatio(hex, ghex);
      return { gname, r, pass: floor === null || r >= floor };
    });
    const worst = row.reduce((a, b) => (a.r < b.r ? a : b));
    const flag = worst.pass ? " " : "!";
    console.log(
      `  ${flag} ${name.padEnd(14)} ${hex}  ` +
        row.map((x) => `${x.gname} ${fmtRatio(x.r)}`).join("  ") +
        `   [${floor === null ? `no floor · ${use}` : `floor ${floor}:1 · ${use}`}]`,
    );
    if (!worst.pass) contrastProblems++;
  }
  // onBrand is read on the brand fill, not on a page ground.
  const onBrand = contrastRatio(set.onBrand, set.brand);
  const okOn = onBrand >= AA.body;
  console.log(
    `  ${okOn ? " " : "!"} ${"onBrand".padEnd(14)} ${set.onBrand}  on brand ${fmtRatio(onBrand)}   [floor 4.5:1 · body]`,
  );
  if (!okOn) contrastProblems++;

  // Status chips — the pattern that makes the pending cyan safe on light, and
  // the reason `<role>Ink` exists at all. On light the ink is the family's Ink
  // step over its 50 fill; on dark the role hue over a 14% wash of itself,
  // composited on the surface.
  const RAMP = { success: "emerald", warning: "warn", critical: "danger", review: "review" };
  for (const role of Object.keys(RAMP)) {
    let fill, ink;
    if (themeName === "LIGHT") {
      fill = tokens.palette[RAMP[role]][tokens.statusChip.light.fillStep];
      ink = set[`${role}Ink`];
    } else {
      // Composite the alpha wash over the surface so the ratio is the one a
      // viewer actually sees, not the one against a transparent layer.
      const a = tokens.statusChip.dark.fillAlpha;
      const mix = (c, b) => Math.round(c * a + b * (1 - a));
      const [r1, g1, b1] = hexToRgb(set[role]);
      const [r2, g2, b2] = hexToRgb(set.surface);
      fill =
        "#" +
        [mix(r1, r2), mix(g1, g2), mix(b1, b2)]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
      ink = set[role];
    }
    const r = contrastRatio(ink, fill);
    const ok = r >= AA.body;
    console.log(
      `  ${ok ? " " : "!"} chip ${role.padEnd(9)} ink ${ink} on fill ${fill}  ${fmtRatio(r)}   [floor 4.5:1 · body]`,
    );
    if (!ok) contrastProblems++;
  }
  console.log("");
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log("=== SUMMARY ===");
console.log(`  deliberate deltas : ${deltas}  (each itemised above with a reason)`);
console.log(`  unexplained diffs : ${failures}`);
console.log(`  contrast problems : ${contrastProblems}`);

if (failures > 0) {
  console.error(
    "\nFIDELITY FAILED — the generator would change something not on the deliberate list.",
  );
  process.exit(1);
}
if (contrastProblems > 0) {
  console.error("\nCONTRAST FAILED — a role is under its floor for its stated use.");
  process.exit(1);
}
console.log("\nOK — every difference is accounted for, every role clears its floor.");
