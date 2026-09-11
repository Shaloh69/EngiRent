"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import { MotionConfig } from "framer-motion";

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
// D-58 (E3.3). framer-motion animates with JS-driven inline styles, so the
// `@media (prefers-reduced-motion: reduce)` block in CSS CANNOT stop it --
// its default `reducedMotion` is "never". One MotionConfig at the root makes
// every `motion.*` component on this surface honour the OS setting, which is
// why this is here rather than a useReducedMotion() call per component:
// E3's job is to define a thing ONCE.
  return (
    <NextThemesProvider {...themeProps}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemesProvider>
  );
}
