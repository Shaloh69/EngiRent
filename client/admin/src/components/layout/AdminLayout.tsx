"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  Burger,
  Group,
  NavLink,
  Text,
  Avatar,
  Menu,
  ActionIcon,
  Badge,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { spotlight, Spotlight } from "@mantine/spotlight";
import { motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  CheckCircle2,
  CreditCard,
  HeartPulse,
  IdCard,
  LayoutDashboard,
  LogOut,
  MonitorSpeaker,
  Package,
  Receipt,
  Search,
  Settings,
  ShieldAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { ColorSchemeToggle } from "@/components/ui/ColorSchemeToggle";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { name: "Users", icon: Users, href: "/users" },
  { name: "Items", icon: Package, href: "/items" },
  { name: "Rentals", icon: Receipt, href: "/rentals" },
  // Deliberately its own top-level entry rather than a filter on /rentals —
  // the mandate calls out dispute resolution as a distinct admin
  // responsibility that shouldn't be buried in the general rentals table.
  { name: "Disputes", icon: ShieldAlert, href: "/disputes" },
  { name: "Payments", icon: CreditCard, href: "/payments" },
  // Renamed: this page lists AI condition checks on rentals, not student ID
  // reviews. The old label made it look like the ID queue and hid the fact
  // that no ID queue existed (mandate §2.11).
  { name: "Condition checks", icon: CheckCircle2, href: "/verifications" },
  { name: "ID verification", icon: IdCard, href: "/id-verifications" },
  { name: "Reports", icon: BarChart3, href: "/reports" },
  { name: "Kiosk", icon: MonitorSpeaker, href: "/kiosk" },
  { name: "Health Check", icon: HeartPulse, href: "/health" },
  { name: "Settings", icon: Settings, href: "/settings" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    router.push("/login");
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <Spotlight
        actions={menuItems.map((item) => ({
          id: item.href,
          label: item.name,
          leftSection: <item.icon size={18} />,
          onClick: () => router.push(item.href),
        }))}
        nothingFound="No matching page"
        highlightQuery
        searchProps={{ placeholder: "Jump to a page… (⌘K)" }}
      />
      <AppShell
        header={{ height: 64 }}
        navbar={{
          width: 260,
          breakpoint: "lg",
          collapsed: { mobile: !mobileOpened },
        }}
        padding="md"
      >
        <AppShell.Header bg="var(--color-surface)">
          <Group h="100%" px="md" justify="space-between">
            <Group gap="sm">
              <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="lg" size="sm" />
              <Link href="/dashboard" style={{ textDecoration: "none" }}>
                <Group gap="xs">
                  <ThemeIcon size={36} radius="md" variant="filled" color="teal">
                    <Text fw={800} size="sm">ER</Text>
                  </ThemeIcon>
                  <div>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" lh={1.1}>
                      Control
                    </Text>
                    <Text size="sm" fw={800} lh={1.2}>
                      EngiRent Admin
                    </Text>
                  </div>
                </Group>
              </Link>
            </Group>

            <Group gap="xs">
              <ActionIcon
                variant="light"
                color="gray"
                size="lg"
                onClick={() => spotlight.open()}
                aria-label="Search (Cmd+K)"
              >
                <Search size={16} />
              </ActionIcon>
              {/* Mandate §1.6 — the scheme toggle lives in the shell header so
                  it's reachable from every page, not just login. */}
              <ColorSchemeToggle />
              <Badge
                variant="light"
                color="gray"
                leftSection={<Bell size={12} />}
                visibleFrom="md"
              >
                Monitoring
              </Badge>
              <Menu position="bottom-end" shadow="md" width={180}>
                <Menu.Target>
                  <Avatar radius="xl" color="teal" style={{ cursor: "pointer" }}>
                    A
                  </Avatar>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<LogOut size={14} />}
                    color="red"
                    onClick={handleLogout}
                  >
                    Logout
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Group>
        </AppShell.Header>

        {/* Explicit bg/borders on Header and Navbar: both default to
            transparent, so they inherited whatever the page body painted
            behind them. That's how the sidebar's dark nav text ended up
            invisible against a dark body background. Pinning them to a real
            surface color makes this section's contrast independent of the
            body, rather than accidentally correct. */}
        <AppShell.Navbar p="sm" bg="var(--color-surface)">
          {menuItems.map((item) => (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={item.name}
              leftSection={<item.icon size={18} />}
              active={isActive(item.href)}
              variant="filled"
              color="teal"
              onClick={toggleMobile}
              styles={{ root: { borderRadius: "var(--mantine-radius-md)", marginBottom: 4 } }}
            />
          ))}
        </AppShell.Navbar>

        <AppShell.Main>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </AppShell.Main>
      </AppShell>
    </>
  );
}
