// Shared helpers for the E3.1 token toolchain: reference resolution and WCAG
// contrast. Kept dependency-free on purpose — this runs from four different
// package roots (Flutter has no node_modules at all) and adding a build
// dependency to fetch a colour library would be the heaviest possible way to
// divide two luminances.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const TOKENS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(TOKENS_DIR, "..", "..");

export function loadTokens() {
  return JSON.parse(readFileSync(join(TOKENS_DIR, "tokens.json"), "utf8"));
}

/** `{palette.teal.500}` -> the raw hex. Non-reference strings pass through. */
export function resolveRef(tokens, value) {
  const m = /^\{([^}]+)\}$/.exec(String(value));
  if (!m) return value;
  const hit = m[1].split(".").reduce((node, key) => node?.[key], tokens);
  if (typeof hit !== "string") {
    throw new Error(`Unresolvable token reference: ${value}`);
  }
  return resolveRef(tokens, hit);
}

/** A theme's semantic block with every reference resolved to a literal hex. */
export function resolveSemantic(tokens, theme) {
  const out = {};
  for (const [role, value] of Object.entries(tokens.semantic[theme])) {
    if (role.startsWith("$")) continue;
    out[role] = resolveRef(tokens, value);
  }
  return out;
}

/** Ramp entries only — drops the `$note` keys the JSON carries for humans. */
export function rampSteps(ramp) {
  return Object.fromEntries(
    Object.entries(ramp).filter(([k]) => !k.startsWith("$")),
  );
}

// ── WCAG 2.1 relative luminance and contrast ────────────────────────────────

export function hexToRgb(hex) {
  const h = String(hex).trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a 6-digit hex: ${hex}`);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG thresholds by use. `body` is the 4.5:1 floor for normal text, `large`
 * the 3:1 allowance for 18pt/14pt-bold, `ui` the 3:1 floor for the boundary of
 * an interactive component or a meaningful graphic (1.4.11). A colour failing
 * `body` is not necessarily a defect — it depends what it is used FOR, which
 * is why the report names the use rather than printing one pass/fail column.
 */
export const AA = { body: 4.5, large: 3.0, ui: 3.0 };

export function fmtRatio(n) {
  return `${n.toFixed(2)}:1`;
}
