"use client";

import { useState } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import clsx from "clsx";

import { siteConfig } from "@/config/site";
import { androidRelease } from "@/config/release";
import { ThemeSwitch } from "@/components/theme-switch";
import { Logo } from "@/components/icons";

/**
 * Site header — a drawing title block, not a nav bar.
 *
 * The previous header was a centred row of links between a wordmark and a
 * "Read Docs" button: the default arrangement in every SaaS starter, and the
 * single most template-looking element on the site. The mandate's ban table
 * exists for exactly this kind of thing.
 *
 * This replaces it with the header engineering drawings actually use — a
 * title block: the sheet's identity on the left, hard facts in ruled mono
 * cells beside it, and the sections listed underneath as a numbered sheet
 * index rather than a centred link row. It suits a surface whose palette is
 * literally called Blueprint, and it makes the version and system status
 * ambient information rather than something buried on a page.
 *
 * Navigation is still one tap away — the index is a real list, just typeset
 * as drawing tabs instead of marketing links.
 */
export const Navbar = () => {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const items = siteConfig.navItems;
  const activeIndex = items.findIndex((i) => i.href === pathname);
  const sheetNo = String(activeIndex < 0 ? 1 : activeIndex + 1).padStart(2, "0");
  const sheetTotal = String(items.length).padStart(2, "0");

  return (
    <header className="site-header">
      {/* ── Title block ─────────────────────────────────────────────── */}
      <div className="title-block">
        <NextLink href="/" className="tb-brand" onClick={close}>
          <span className="tb-mark">
            <Logo size={18} />
          </span>
          <span className="tb-brand-text">
            <span className="tb-brand-name">{siteConfig.name}</span>
            <span className="tb-brand-sub">UCLM · Smart Locker Rental</span>
          </span>
        </NextLink>

        {/* Ruled spec cells. Real values, not decoration. */}
        <dl className="tb-fields">
          <div className="tb-field">
            <dt>Sheet</dt>
            <dd>
              {sheetNo}/{sheetTotal}
            </dd>
          </div>
          <div className="tb-field">
            <dt>Rev</dt>
            <dd>{androidRelease.version}</dd>
          </div>
          <div className="tb-field tb-field--status">
            <dt>Status</dt>
            <dd>
              <span className="tb-dot" aria-hidden />
              Live
            </dd>
          </div>
        </dl>

        <div className="tb-actions">
          <ThemeSwitch />
          <NextLink href="/download" className="tb-cta">
            Get the app
          </NextLink>
          <button
            type="button"
            aria-label={open ? "Close index" : "Open index"}
            onClick={() => setOpen((v) => !v)}
            className="tb-menu"
          >
            {open ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </div>

      {/* ── Sheet index ─────────────────────────────────────────────── */}
      <nav className="sheet-index" aria-label="Sections">
        {items.map((item, i) => (
          <NextLink
            key={item.href}
            href={item.href}
            onClick={close}
            className={clsx(
              "sheet-tab",
              pathname === item.href && "sheet-tab--active",
            )}
          >
            <span className="sheet-tab-n">
              {String(i + 1).padStart(2, "0")}
            </span>
            {item.label}
          </NextLink>
        ))}
      </nav>

      {/* Mobile: the index collapses into a disclosure rather than wrapping
          into three cramped rows. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="sheet-index-mobile"
          >
            {items.map((item, i) => (
              <NextLink
                key={item.href}
                href={item.href}
                onClick={close}
                className={clsx(
                  "sheet-tab sheet-tab--mobile",
                  pathname === item.href && "sheet-tab--active",
                )}
              >
                <span className="sheet-tab-n">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {item.label}
              </NextLink>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
