"use client";

import { useState } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import clsx from "clsx";

import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { Logo } from "@/components/icons";

// Rebuilt on Velora's plain Tailwind/Motion stack — Mantine is deliberately
// not used on this surface (design mandate §3.5).
export const Navbar = () => {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
        <NextLink href="/" className="brand-link">
          <span className="flex size-9 items-center justify-center rounded-md bg-[var(--brand-primary)] text-white">
            <Logo size={18} />
          </span>
          <span>
            <span className="block text-[10px] font-bold uppercase leading-none tracking-[2px] text-[var(--brand-muted)]">
              Smart Kiosk
            </span>
            <span className="block text-[15px] font-extrabold leading-tight">
              {siteConfig.name}
            </span>
          </span>
        </NextLink>

        <nav className="hidden items-center gap-7 md:flex">
          {siteConfig.navItems.map((item) => navLink(item))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeSwitch />
          <NextLink
            href="/docs"
            className="hidden rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.03] sm:inline-block"
          >
            Read Docs
          </NextLink>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--brand-border)] md:hidden"
          >
            {open ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-t border-[var(--brand-border)] bg-[var(--brand-surface)] md:hidden"
          >
            <div className="mx-auto flex max-w-7xl flex-col px-6 py-3">
              {siteConfig.navItems.map((item) => navLink(item, true))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
