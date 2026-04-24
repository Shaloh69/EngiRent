import type { Metadata } from "next";
import { Manrope } from "next/font/google";
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
  return (
    <html lang="en">
      <body className={`${manrope.className} ${manrope.variable} app-shell`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
