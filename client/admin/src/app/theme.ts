import { createTheme } from "@mantine/core";

// "EngiRent Vault" — mandated palette (docs/planning/02-design-mandate.md §1),
// "Campus Day" mode (warm off-white, not stark white) for this surface.
//
// E3.1: the tuples are no longer written here. They are generated from
// design/tokens/tokens.json, which is also what produces the Flutter app's
// AppColors, the kiosk's CSS variables and the website's. Mantine still needs a
// 10-shade tuple per colour and it still lands the mandated hex at shade 5 —
// that has not changed, only where the numbers come from. `review` is new: the
// cyan-teal PENDING family, which had no Mantine colour before because the
// console rendered pending as warning-yellow.
import {
  palettes,
  radius as tokenRadius,
  shadowHairline,
} from "./design-tokens.g";

export {
  roleColor,
  statusRole,
  statusColorKey,
  statusChip,
  statusChipStyle,
  semantic,
} from "./design-tokens.g";

const { teal, gold, coral, emerald, warn, danger, review, dark } = palettes;

export const theme = createTheme({
  primaryColor: "teal",
  colors: { teal, gold, coral, emerald, warn, danger, review, dark },

  // Mandate §1.2 — three families, each with a job. Inter is explicitly
  // banned as the single most recognizable tell of generated UI; this stack
  // is loaded via next/font in layout.tsx and exposed as CSS variables.
  fontFamily: "var(--font-body), ui-sans-serif, system-ui, sans-serif",
  fontFamilyMonospace: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
  headings: {
    fontFamily: "var(--font-display), ui-sans-serif, system-ui, sans-serif",
    fontWeight: "700",
  },

  // Mandate §1.4 — machined edges, hard cap 6px. Mantine's own "md" is 8px,
  // which is already over the cap, so every step is redefined rather than
  // relying on the library scale. Values from the token source.
  defaultRadius: "sm",
  radius: {
    xs: `${tokenRadius.input}px`,
    sm: `${tokenRadius.button}px`,
    md: `${tokenRadius.card}px`,
    lg: `${tokenRadius.card}px`,
    xl: `${tokenRadius.card}px`,
  },

  // Mandate §1.4 — borders do the work shadows used to. One token, not a ladder.
  shadows: {
    xs: shadowHairline,
    sm: shadowHairline,
    md: shadowHairline,
    lg: shadowHairline,
    xl: shadowHairline,
  },

  // "Campus Day" — warm off-white, not stark #FFFFFF (mandate §1).
  white: "#F7F9FC",
  black: "#0f2622",

  components: {
    // Mantine defaults Button to a pill-ish radius via its own scale; the
    // mandate bans pills outright, so pin it at the button step.
    Button: { defaultProps: { radius: "sm" } },
    Card: { defaultProps: { radius: "md", withBorder: true, shadow: "xs" } },
    Paper: { defaultProps: { radius: "md" } },
    TextInput: { defaultProps: { radius: "xs" } },
    PasswordInput: { defaultProps: { radius: "xs" } },
    Select: { defaultProps: { radius: "xs" } },
    Badge: { defaultProps: { radius: "xs" } },
  },
});

// `surfaceTokens` used to live here. Removed in E3.1, and it is worth saying
// why rather than just deleting it: it had ZERO consumers (a repo-wide grep
// found only its own definition), and its dark half — #071310 / #0E1F1B /
// #12271F / #1E3B35 — was green-tinted, disagreeing with the blue-tinted dark
// that the Mantine `dark` tuple, globals.css, the Flutter app, the kiosk and
// the website all actually render. It was a stale second opinion sitting one
// import away from being believed. The live equivalents are the generated
// `semantic.light` / `semantic.dark` re-exported above, and the CSS variables
// in design-tokens.g.css.
//
// `roleColor` also used to be declared here and is now re-exported from the
// generated module, which additionally carries `review` — the cyan-teal
// PENDING family this console previously rendered as warning-yellow.
