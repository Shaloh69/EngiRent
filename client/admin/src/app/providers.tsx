"use client";

import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { theme } from "./theme";

// HeroUI is fully removed as of the delete-and-rebuild pass — every page is
// on Mantine now, so the transitional nested-provider setup is gone. Keeping
// both would have meant two component libraries each following their own
// color-scheme rules, which is exactly what produced the unreadable
// light-on-light text this rebuild fixed.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light" forceColorScheme="light">
      <Notifications position="top-right" />
      {children}
    </MantineProvider>
  );
}
