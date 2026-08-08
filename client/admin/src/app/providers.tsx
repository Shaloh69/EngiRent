"use client";

import { MantineProvider, localStorageColorSchemeManager } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { theme } from "./theme";

const colorSchemeManager = localStorageColorSchemeManager({
  key: "engirent-admin-color-scheme",
});

// HeroUI is fully removed as of the delete-and-rebuild pass — every page is
// on Mantine now, so the transitional nested-provider setup is gone. Keeping
// both would have meant two component libraries each following their own
// color-scheme rules, which is exactly what produced the unreadable
// light-on-light text that rebuild fixed.
//
// `forceColorScheme="light"` was the stopgap that stopped that breakage by
// disabling dark mode outright. Mandate §1.6 now requires both schemes as
// first-class, so the force is gone: Mantine manages the scheme, persists it
// to localStorage under the key below, and follows the OS by default.
// globals.css defines the matching surface tokens for both schemes so the
// page chrome can never again disagree with the component library.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      <Notifications position="top-right" />
      {children}
    </MantineProvider>
  );
}
