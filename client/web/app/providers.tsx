"use client";

import type { ThemeProviderProps } from "next-themes";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { MantineProvider } from "@mantine/core";
import { theme } from "@/config/theme";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

// HeroUIProvider removed — the last @heroui/* component import in this app
// (theme-switch.tsx's useSwitch) was replaced with a plain Mantine
// ActionIcon during the design-mandate migration. Mantine is now the sole
// component base for this surface (docs/planning/02-design-mandate.md §1:
// "Not HeroUI, not a HeroUI reskin").
export function Providers({ children, themeProps }: ProvidersProps) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <NextThemesProvider {...themeProps}>{children}</NextThemesProvider>
    </MantineProvider>
  );
}
