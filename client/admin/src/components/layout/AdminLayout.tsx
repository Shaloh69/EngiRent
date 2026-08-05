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
  LayoutDashboard,
  Users,
  Package,
  Receipt,
  CheckCircle2,
  BarChart3,
  CreditCard,
  LogOut,
  MonitorSpeaker,
  HeartPulse,
  Search,
  Bell,
} from "lucide-react";
import Link from "next/link";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { name: "Users", icon: Users, href: "/users" },
  { name: "Items", icon: Package, href: "/items" },
  { name: "Rentals", icon: Receipt, href: "/rentals" },
  { name: "Payments", icon: CreditCard, href: "/payments" },
  { name: "Verifications", icon: CheckCircle2, href: "/verifications" },
  { name: "Reports", icon: BarChart3, href: "/reports" },
  { name: "Kiosk", icon: MonitorSpeaker, href: "/kiosk" },
  { name: "Health Check", icon: HeartPulse, href: "/health" },
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
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="sm">
              <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="lg" size="sm" />
              <Link href="/dashboard" style={{ textDecoration: "none" }}>
                <Group gap="xs">
                  <ThemeIcon size={36} radius="md" variant="filled" color="violet">
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
                  <Avatar radius="xl" color="violet" style={{ cursor: "pointer" }}>
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

        <AppShell.Navbar p="sm">
          {menuItems.map((item) => (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={item.name}
              leftSection={<item.icon size={18} />}
              active={isActive(item.href)}
              variant="filled"
              color="violet"
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
