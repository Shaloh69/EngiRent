"use client";

import { FC } from "react";
import { ActionIcon } from "@mantine/core";
import { useTheme } from "next-themes";
import { useIsSSR } from "@react-aria/ssr";

import { SunFilledIcon, MoonFilledIcon } from "@/components/icons";

export interface ThemeSwitchProps {
  className?: string;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({ className }) => {
  const { theme, setTheme } = useTheme();
  const isSSR = useIsSSR();
  const isLight = theme === "light" || isSSR;

  return (
    <ActionIcon
      aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
      className={className}
      color="gray"
      size="lg"
      variant="subtle"
      onClick={() => setTheme(isLight ? "dark" : "light")}
    >
      {isLight ? <SunFilledIcon size={20} /> : <MoonFilledIcon size={20} />}
    </ActionIcon>
  );
};
