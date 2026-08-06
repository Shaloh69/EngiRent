"use client";

import { Group, Burger, Button, Text, ThemeIcon, Drawer, Stack, Box } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { Logo } from "@/components/icons";

export const Navbar = () => {
  const pathname = usePathname();
  const [opened, { toggle, close }] = useDisclosure();

  const navLink = (item: { label: string; href: string }, mobile = false) => (
    <NextLink
      key={item.href}
      href={item.href}
      onClick={close}
      className={clsx(
        mobile ? "nav-link nav-link--mobile" : "nav-link",
        pathname === item.href && "nav-link--active",
      )}
    >
      {item.label}
    </NextLink>
  );

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Group gap="xs">
          <NextLink href="/" className="brand-link">
            <ThemeIcon size={36} radius="md" variant="filled" color="violet">
              <Logo size={18} />
            </ThemeIcon>
            <div>
              <Text size="10px" fw={700} tt="uppercase" c="dimmed" lh={1.1} style={{ letterSpacing: 2 }}>
                Smart Kiosk
              </Text>
              <Text size="sm" fw={800} lh={1.2}>
                {siteConfig.name}
              </Text>
            </div>
          </NextLink>
        </Group>

        <Group gap={28} visibleFrom="md">
          {siteConfig.navItems.map((item) => navLink(item))}
        </Group>

        <Group gap="sm">
          <Box visibleFrom="sm">
            <ThemeSwitch />
          </Box>
          <Button
            component={NextLink}
            href={siteConfig.links.docs}
            color="violet"
            radius="sm"
            visibleFrom="sm"
          >
            Read Docs
          </Button>
          <Burger opened={opened} onClick={toggle} hiddenFrom="md" size="sm" />
        </Group>
      </div>

      <Drawer opened={opened} onClose={close} position="right" size="xs" title="Menu">
        <Stack gap="md">
          {siteConfig.navItems.map((item) => navLink(item, true))}
          <ThemeSwitch />
          <Button component={NextLink} href={siteConfig.links.docs} color="violet" onClick={close}>
            Read Docs
          </Button>
        </Stack>
      </Drawer>
    </header>
  );
};
