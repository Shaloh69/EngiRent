"use client";

import {
  ActionIcon,
  Tooltip,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { Moon, Sun } from "lucide-react";

// Mandate §1.6 — light and dark are both first-class on this surface and the
// choice must persist. Persistence is handled by the localStorage scheme
// manager wired up in providers.tsx; this is just the control.
//
// `useComputedColorScheme` (not `colorScheme`) is what resolves "auto" into
// the concrete light/dark actually being rendered — reading the raw value
// would show "auto" and the icon would be wrong on OS-dark machines.
export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const isDark = computed === "dark";

  return (
    <Tooltip label={isDark ? "Switch to light" : "Switch to dark"} withArrow>
      <ActionIcon
        onClick={() => setColorScheme(isDark ? "light" : "dark")}
        variant="default"
        size="lg"
        radius="sm"
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      >
        {isDark ? <Sun size={17} /> : <Moon size={17} />}
      </ActionIcon>
    </Tooltip>
  );
}
