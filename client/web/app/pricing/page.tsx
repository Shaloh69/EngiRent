"use client";

import { AlertTriangle, ArrowRight, Clock, Info, ShieldCheck, Wallet } from "lucide-react";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { Card, Reveal, Section, SectionHeading } from "@/components/velora/section";

// Deliberately not a three-tier SaaS pricing table: EngiRent takes no
// platform commission (rental payments are a full pass-through to the
// owner — there is no fee field anywhere in the schema), so inventing
// "Basic / Pro / Enterprise" plans would misrepresent the real money model.
// What students actually need to understand is where their money goes and
// when it comes back, so that's what this page explains.

const MONEY_FLOW = [
  {
    icon: Wallet,
    label: "Rental fee",
    who: "Renter → Owner",
    body: "Set by the owner as a daily rate. Held until the item is verifiably deposited, then paid out to the owner on completion.",
    accent: "var(--brand-primary)",
  },
  {
    icon: ShieldCheck,
    label: "Security deposit",
    who: "Renter → held → Renter",
    body: "Refundable. Held for the whole rental and returned in full unless late or damage fees are deducted.",
    accent: "var(--brand-secondary)",
  },
  {
    icon: Clock,
    label: "Late fee",
    who: "Deducted from deposit",
    body: "Charged per day past the return date, at a rate that depends on the item's category.",
    accent: "var(--brand-accent)",
  },
  {
    icon: AlertTriangle,
    label: "Damage fee",
    who: "Deducted from deposit",
    body: "Applied only after an admin reviews the AI verification evidence and settles the dispute.",
    accent: "#ef4444",
  },
];

const LATE_FEES = [
  { category: "School Attire", rate: "₱12" },
  { category: "Academic Tools", rate: "₱15" },
  { category: "Electronics", rate: "₱28" },
  { category: "Development Kits", rate: "₱20" },
  { category: "Measurement Tools", rate: "₱10" },
  { category: "Audio / Visual", rate: "₱45" },
  { category: "Sports Equipment", rate: "₱50" },
  { category: "Other", rate: "₱50" },
];

export default function PricingPage() {
  return (
    <>
      <section className="relative overflow-hidden px-4 py-20 sm:px-6">
        <AuroraBackground intensity="subtle" />
        <div className="relative mx-auto w-full max-w-6xl">
          <SectionHeading
            align="left"
            eyebrow="Pricing"
            title="No platform fee. Just the rental and a refundable deposit."
            description="EngiRent doesn't take a commission — the rental fee passes through to the student who owns the item. The only other money involved is a deposit that comes back to you."
          />
        </div>
      </section>

      <Section className="pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          {MONEY_FLOW.map((m, i) => (
            <Reveal key={m.label} delay={i * 0.06}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="flex size-10 items-center justify-center rounded-md"
                    style={{
                      background: `color-mix(in srgb, ${m.accent} 14%, transparent)`,
                      color: m.accent,
                    }}
                  >
                    <m.icon size={20} />
                  </div>
                  <span className="rounded-xs border border-[var(--brand-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-muted)]">
                    {m.who}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold">{m.label}</h3>
                <p className="mt-1 text-sm text-[var(--brand-muted)]">{m.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <SectionHeading
          eyebrow="Late fees"
          title="What overdue costs, by category"
          description="Charged per day against the held deposit. Rates differ by category because replacement cost does."
        />
        <Reveal>
          <Card className="mt-10 overflow-hidden p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--brand-border)] bg-[var(--brand-soft)]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Category</th>
                  <th className="px-5 py-3 font-semibold">Per day overdue</th>
                </tr>
              </thead>
              <tbody>
                {LATE_FEES.map((f) => (
                  <tr key={f.category} className="border-b border-[var(--brand-border)] last:border-0">
                    <td className="px-5 py-3">{f.category}</td>
                    <td className="px-5 py-3 font-semibold text-[var(--brand-primary)]">
                      {f.rate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-6 flex items-start gap-3 rounded-md border border-[var(--brand-border)] bg-[var(--brand-soft)] p-5">
            <Info size={18} className="mt-0.5 shrink-0 text-[var(--brand-primary)]" />
            <p className="text-sm text-[var(--brand-muted)]">
              Late and damage fees are never charged as a new payment — they&apos;re
              deducted from the deposit already being held, so you&apos;re never
              billed after the fact. If deductions exceed the deposit, an admin
              reviews the shortfall rather than the system auto-charging you.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section className="pt-0">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-[var(--brand-border)] bg-[var(--brand-surface)] px-6 py-12 text-center sm:px-12">
            <AuroraBackground intensity="subtle" />
            <div className="relative flex flex-col items-center gap-3">
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                Want the full breakdown?
              </h2>
              <p className="max-w-xl text-sm text-[var(--brand-muted)]">
                The docs cover the escrow flow, verification thresholds, and how
                settlement is calculated end to end.
              </p>
              <a
                href="/docs"
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
              >
                Read the docs
                <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
