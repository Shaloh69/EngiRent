"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// Shared layout primitives in Velora's flat, Tailwind-utility style —
// deliberately not Mantine components (design mandate §3.5: this surface
// uses Velora's shadcn/ui-based stack, kept separate from the app surfaces).

export function Section({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("px-4 py-16 sm:px-6 sm:py-20", className)} {...props}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-xs border border-[var(--brand-border)] bg-[var(--brand-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--brand-primary)]">
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        align === "center" ? "items-center text-center" : "items-start",
      )}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
      {description && (
        <p className="max-w-2xl text-base text-[var(--brand-muted)]">{description}</p>
      )}
    </div>
  );
}

export function Card({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md border border-[var(--brand-border)] bg-[var(--brand-surface)] p-6 transition-shadow hover:shadow-[0_12px_40px_rgba(13,148,136,0.10)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// Staggered entrance used by every grid on the site, so cards animate in
// consistently instead of each page rolling its own timing.
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
