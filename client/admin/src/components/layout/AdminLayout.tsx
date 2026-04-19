"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Chip,
} from "@heroui/react";
import {
  LayoutDashboard,
  Users,
  Package,
  Receipt,
  CheckCircle2,
  BarChart3,
  LogOut,
  User as UserIcon,
  Menu,
  X,
  Bell,
  MonitorSpeaker,
} from "lucide-react";
import Link from "next/link";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { name: "Users", icon: Users, href: "/users" },
  { name: "Items", icon: Package, href: "/items" },
  { name: "Rentals", icon: Receipt, href: "/rentals" },
  { name: "Verifications", icon: CheckCircle2, href: "/verifications" },
  { name: "Reports", icon: BarChart3, href: "/reports" },
  { name: "Kiosk", icon: MonitorSpeaker, href: "/kiosk" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    router.push("/login");
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button
              isIconOnly
              variant="light"
              className="lg:hidden"
              onPress={() => setMenuOpen((value) => !value)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </Button>
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-primary)] text-white">
                ER
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  Control
                </p>
                <p className="text-base font-extrabold text-[var(--color-ink)]">
                  EngiRent Admin
                </p>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <Chip
              size="sm"
              variant="flat"
              className="hidden md:inline-flex border border-[var(--color-border)] bg-[var(--color-surface-soft)] text-[var(--color-muted)]"
              startContent={<Bell size={14} />}
            >
              Monitoring
            </Chip>
            <Dropdown>
              <DropdownTrigger>
                <Button
                  isIconOnly
                  variant="flat"
                  className="bg-[var(--color-surface-soft)]"
                >
                  <UserIcon size={18} />
                </Button>
              </DropdownTrigger>
              <DropdownMenu aria-label="Profile actions">
                <DropdownItem
                  key="logout"
                  onClick={handleLogout}
                  startContent={<LogOut size={16} />}
                  color="danger"
                >
                  Logout
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] gap-4 px-4 py-4 sm:px-6 sm:py-6">
        <aside className="hidden w-64 shrink-0 lg:block">
          <nav className="app-surface sticky top-24 space-y-1 rounded-2xl border border-[var(--color-border)] p-3">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  isActive(item.href)
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
                }`}
              >
                <item.icon size={18} />
                {item.name}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {menuOpen && (
            <nav className="app-surface mb-4 space-y-1 rounded-2xl border border-[var(--color-border)] p-3 lg:hidden">
              {menuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    isActive(item.href)
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  <item.icon size={18} />
                  {item.name}
                </Link>
              ))}
            </nav>
          )}
          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}
