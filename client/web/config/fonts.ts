import {
  Space_Grotesk as FontDisplay,
  IBM_Plex_Mono as FontMono,
  Manrope as FontSans,
} from "next/font/google";

// Mandate §1.2 — one type stack shared by every surface, so the promotional
// site and the app surfaces read as the same product. Three families, each
// with a job: Space Grotesk for display, IBM Plex Mono for anything numeric
// or identifier-like, Manrope for body.
//
// JetBrains Mono was the previous mono here; swapped to IBM Plex Mono so the
// numerals match the Admin Console and the Phone App exactly rather than
// being a near-miss.
export const fontSans = FontSans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans-loaded",
  display: "swap",
});

export const fontDisplay = FontDisplay({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display-loaded",
  display: "swap",
});

export const fontMono = FontMono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono-loaded",
  display: "swap",
});
