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
  "#0D9488", "#0c857a", "#0a7169", "#085d57", "#064a45",
];
const gold: MantineColorsTuple = [
  "#fef6e7", "#fce8c2", "#fad89a", "#f8c86f", "#f6ba4d",
  "#F5A623", "#e0951a", "#c78314", "#ad710f", "#935f0a",
];
const coral: MantineColorsTuple = [
  "#ffeef0", "#ffd7dc", "#ffb0ba", "#fd8797", "#fc6478",
  "#FB7185", "#e35f72", "#c94d60", "#af3c4f", "#952b3d",
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

export const theme = createTheme({
  primaryColor: "teal",
  colors: { teal, gold, coral, emerald, warn, danger },
  fontFamily:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  headings: { fontWeight: "700" },
  defaultRadius: "md",
  // "Campus Day" — warm off-white, not stark #FFFFFF (mandate §1).
  white: "#FDFBF7",
  black: "#0f2622",
});

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
