import { createTheme, MantineColorsTuple } from "@mantine/core";

// EngiRent Spectrum — mandated palette (docs/planning/02-design-mandate.md §1),
// "Campus Day" mode (warm off-white, not stark white) for this surface.
// Mantine needs a 10-shade tuple per color; shades were generated around
// each mandated hex so it lands as Mantine's default "shade 6" (its primary
// interactive shade) — the mandate only specifies the one reference hex per
// role, the surrounding tints/shades are this implementation's own scale.
const violet: MantineColorsTuple = [
  "#f3edfe", "#e4d6fc", "#c9adf8", "#ac82f3", "#935cf0",
  "#7C3AED", "#6f2fe0", "#5f24c7", "#521faf", "#451a96",
];
const amber: MantineColorsTuple = [
  "#fef6e7", "#fce8c2", "#fad89a", "#f8c86f", "#f6ba4d",
  "#F5A623", "#e0951a", "#c78314", "#ad710f", "#935f0a",
];
const coral: MantineColorsTuple = [
  "#ffeef0", "#ffd7dc", "#ffb0ba", "#fd8797", "#fc6478",
  "#FB7185", "#e35f72", "#c94d60", "#af3c4f", "#952b3d",
];
const emerald: MantineColorsTuple = [
  "#e6faf3", "#c1f2e0", "#96e8cb", "#68deb6", "#43d6a5",
  "#10B981", "#0ea371", "#0b8c62", "#097553", "#065f44",
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
  primaryColor: "violet",
  colors: { violet, amber, coral, emerald, warn, danger },
  fontFamily:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  headings: { fontWeight: "700" },
  defaultRadius: "md",
  // "Campus Day" — warm off-white, not stark #FFFFFF (mandate §1).
  white: "#FDFBF7",
  black: "#1A1625",
});

// Semantic aliases so page code reads by role, not by raw color name —
// "success"/"critical" survive a future palette tweak, "emerald"/"danger"
// as literal Mantine color props wouldn't.
export const roleColor = {
  success: "emerald",
  warning: "warn",
  critical: "danger",
  brand: "violet",
  accent: "amber",
  cta: "coral",
} as const;
