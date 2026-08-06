import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/charts/styles.css";
import "./globals.css";
import { Providers } from "./providers";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-admin" });

export const metadata: Metadata = {
  title: "EngiRent Admin Console",
  description:
    "Admin dashboard for EngiRent Hub IoT-powered Smart Kiosk System",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `light` is pinned explicitly rather than left to default: this surface
  // is light-only ("Campus Day") by mandate, and leaving it unset let
  // HeroUI-styled components pick up the viewer's OS dark preference while
  // Mantine and the CSS variables stayed light — producing unreadable
  // light-on-light text for dark-mode users. colorScheme also tells the
  // browser to keep form controls/scrollbars light.
  return (
    <html lang="en" className="light" style={{ colorScheme: "light" }}>
      <body className={`${manrope.className} ${manrope.variable} app-shell`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
