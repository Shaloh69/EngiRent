import { createTheme, MantineColorsTuple } from "@mantine/core";

// "EngiRent Vault" — mandated palette (docs/planning/02-design-mandate.md §1),
// "Campus Day" mode (warm off-white, not stark white) for this surface.
// Replaces the prior violet-primary "Spectrum" palette, which shipped
// reading as a generic blue/violet SaaS default.
//
// Mantine needs a 10-shade tuple per color; shades were generated around
// each mandated hex so it lands as Mantine's default "shade 6" (its primary
// interactive shade) — the mandate only specifies the one reference hex per
// role, the surrounding tints/shades are this implementation's own scale.
const teal: MantineColorsTuple = [
  "#e6f7f5", "#c0ebe6", "#93ddd4", "#63cfc1", "#3ec3b3",
  "#0B5FA5", "#0a5593", "#08497f", "#073d6b", "#063157",
];
const gold: MantineColorsTuple = [
  "#fef6e7", "#fce8c2", "#fad89a", "#f8c86f", "#f6ba4d",
  "#E9A13B", "#d4902f", "#c07f22", "#a56b1a", "#8a5813",
];
const coral: MantineColorsTuple = [
  "#ffeef0", "#ffd7dc", "#ffb0ba", "#fd8797", "#fc6478",
  "#EF6E7B", "#e05e6c", "#d14f5d", "#b8404e", "#9e323f",
];
// Distinct from the teal brand primary (mandate §1) so "success" never reads
// as just another brand-colored element.
const emerald: MantineColorsTuple = [
  "#e9fbef", "#c6f5d6", "#9aecb8", "#6ce399", "#45dc80",
  "#22C55E", "#1eb054", "#199748", "#147e3c", "#0f6530",
];
const warn: MantineColorsTuple = [
  "#fef5e6", "#fce4bd", "#fad090", "#f8bc61", "#f6ad3d",
  "#F59E0B", "#e08e08", "#c67c06", "#ac6a05", "#925903",
];
const danger: MantineColorsTuple = [
  "#fdecec", "#fbd0d0", "#f8afaf", "#f58d8d", "#f37373",
  "#EF4444", "#d93c3c", "#bf3232", "#a52929", "#8b2020",
];

// Mandate §1.3 — palette-tinted neutrals, not library gray. Mantine's built-in
// `dark` tuple is a neutral slate; leaving it alone made every dark-mode card
// and input render as generic gray on a teal-tinted page, which is the exact
// "library default" look the mandate bans. Overriding the tuple retints every
// Mantine surface at once, rather than patching component-by-component.
// Index order is Mantine's: 0 = lightest text, 9 = deepest background.
const dark: MantineColorsTuple = [
  "#EEF6FF", // body text on dark
  "#CFE2F5",
  "#AFC8E0",
  "#93AEC9", // muted text
  "#5B7A96",
  "#2C4C6B",
  "#1E3A54", // borders
  "#122740", // raised surface
  "#0B1A2A", // card surface
  "#050F1A", // app background
];

export const theme = createTheme({
  primaryColor: "teal",
  colors: { teal, gold, coral, emerald, warn, danger, dark },

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
  // relying on the library scale.
  defaultRadius: "sm",
  radius: { xs: "2px", sm: "4px", md: "6px", lg: "6px", xl: "6px" },

  // Mandate §1.4 — borders do the work shadows used to. One token, not a ladder.
  shadows: {
    xs: "0 1px 2px rgba(7,19,16,.06)",
    sm: "0 1px 2px rgba(7,19,16,.06)",
    md: "0 1px 2px rgba(7,19,16,.06)",
    lg: "0 1px 2px rgba(7,19,16,.06)",
    xl: "0 1px 2px rgba(7,19,16,.06)",
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

// Palette-tinted neutrals (mandate §1.3) for both schemes. Mantine's default
// gray ramp is the generic #6B7280 family the mandate bans, so surface,
// border and muted values are declared here and consumed as CSS variables
// rather than reaching for `gray.N`.
export const surfaceTokens = {
  light: {
    appBg: "#F7F9FC",
    surface: "#FFFFFF",
    surfaceAlt: "#F3F8F7",
    border: "#D5E3F2",
    muted: "#51677F",
    ink: "#0C1F33",
  },
  dark: {
    appBg: "#071310",
    surface: "#0E1F1B",
    surfaceAlt: "#12271F",
    border: "#1E3B35",
    muted: "#7FA39C",
    ink: "#EAF5F2",
  },
} as const;

// Semantic aliases so page code reads by role, not by raw color name —
// "success"/"critical" survive a future palette tweak, "emerald"/"danger"
// as literal Mantine color props wouldn't.
export const roleColor = {
  success: "emerald",
  warning: "warn",
  critical: "danger",
  brand: "teal",
  accent: "gold",
  cta: "coral",
} as const;
