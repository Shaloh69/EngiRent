import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import NextLink from "next/link";
import clsx from "clsx";

import { Providers } from "./providers";
import { siteConfig } from "@/config/site";
import { fontSans } from "@/config/fonts";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f8ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning lang="en">
      <head />
      <body
        className={clsx(
          "min-h-screen font-sans antialiased",
          fontSans.variable,
        )}
      >
        <Providers themeProps={{ attribute: "class", defaultTheme: "light" }}>
          <div className="relative flex min-h-screen flex-col">
            <Navbar />
            {/* Full-bleed: each page owns its own max-width and padding, so
                the aurora hero sections can span the viewport instead of
                being boxed in by a shared container. */}
            <main className="flex-1">{children}</main>
            <footer className="border-t border-[var(--brand-border)] px-4 py-5 sm:px-6">
              <div className="mx-auto flex max-w-7xl flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[var(--brand-muted)]">
                  EngiRent Hub by UCLM Engineering Thesis Team
                </p>
                <NextLink href="/docs" className="text-[var(--brand-primary)]">
                  View Technical Docs
                </NextLink>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
