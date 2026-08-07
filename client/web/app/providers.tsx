"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

// Mantine is deliberately absent from this surface (design mandate §3.5:
// client/web uses Velora UI's shadcn/Tailwind stack, kept separate from the
// app surfaces). next-themes drives the .dark class that globals.css and
// Velora's components key off.
export function Providers({
  children,
  themeProps,
}: {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}) {
  return <NextThemesProvider {...themeProps}>{children}</NextThemesProvider>;
}
