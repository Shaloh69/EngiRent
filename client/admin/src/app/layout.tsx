import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono, Manrope } from "next/font/google";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/charts/styles.css";
import "./globals.css";
import { Providers } from "./providers";

// Mandate §1.2 — three families, each with a distinct job. Inter is banned
// outright as the most recognizable tell of generated UI. Exposed as CSS
// variables so theme.ts, globals.css and component code all resolve the same
// stack instead of each hardcoding a font name.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono",
  display: "swap",
});
const body = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EngiRent Admin Console",
  description:
    "Admin dashboard for EngiRent Hub IoT-powered Smart Kiosk System",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // mantineHtmlProps + ColorSchemeScript are what let the correct scheme be
    // applied before first paint. Without them the page flashes light then
    // corrects, which is how the previous dark-mode mismatch stayed invisible
    // in screenshots taken a beat too early.
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body
        className={`${display.variable} ${mono.variable} ${body.variable} app-shell`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
