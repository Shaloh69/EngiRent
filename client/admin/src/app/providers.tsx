"use client";

import { HeroUIProvider } from "@heroui/react";
import { useRouter } from "next/navigation";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { theme } from "./theme";

// Transitional: both providers nested during the Mantine migration (design
// mandate — HeroUI is being fully replaced, not reskinned). Pages migrate to
// Mantine one at a time; HeroUIProvider stays until the last HeroUI-based
// page is gone, so unmigrated pages keep working in the meantime. Remove
// HeroUIProvider (and the @heroui/* deps) once nothing imports @heroui/react.
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <HeroUIProvider navigate={router.push}>{children}</HeroUIProvider>
    </MantineProvider>
  );
}
