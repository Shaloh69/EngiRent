"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Camera,
  ClipboardList,
  KeyRound,
  PackageCheck,
  QrCode,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { Card, Reveal, Section, SectionHeading } from "@/components/velora/section";

const WORKFLOW = [
  {
    icon: ClipboardList,
    title: "List",
    body: "A student lists equipment they own — calculators, Arduino kits, lab gowns — with a daily rate and deposit.",
  },
  {
    icon: Wallet,
    title: "Request & pay",
    body: "The renter books dates and pays. The rental fee and refundable deposit are both held before anything moves.",
  },
  {
    icon: PackageCheck,
    title: "Deposit at the kiosk",
    body: "The owner drops the item into a smart locker. Cameras capture its condition on the way in.",
  },
  {
    icon: Camera,
    title: "AI verifies",
    body: "An 8-stage computer-vision pipeline compares deposit and return images and scores the match.",
  },
  {
    icon: QrCode,
    title: "Pick up",
    body: "The renter unlocks the locker with a short-lived QR token plus face verification. No staff needed.",
  },
  {
    icon: KeyRound,
    title: "Return & settle",
    body: "On return, the deposit is refunded net of any late or damage fees, and the owner gets paid out.",
  },
];

// Mandate §1.1 bans the icon-grid "features" section — three or four identical
// icon + title + blurb cards — as one of the clearest tells of generated
// layout. It listed a comparison table as an allowed replacement, which suits
// this content better anyway: the product's whole argument is that it removes
// specific failure modes of lending gear informally, and a table can state
// both halves of that instead of asserting one vaguely.
const COMPARISON = [
  {
    stage: "Paying",
    icon: ShieldCheck,
    accent: "var(--brand-primary)",
    without: "Hand over cash and hope. Whoever moves first carries the risk.",
    with: "Payment is escrowed and only released once the item is verifiably deposited.",
  },
  {
    stage: "Handover",
    icon: QrCode,
    accent: "var(--brand-secondary)",
    without: "Meet up, coordinate schedules, and trust the other person showed up with the right thing.",
    with: "A locker holds the item. Short-lived QR tokens and face checks gate every door action.",
  },
  {
    stage: "Damage",
    icon: Camera,
    accent: "var(--brand-accent)",
    without: "One person's memory against another's, with no record of the item's prior condition.",
    with: "Both handovers are photographed at the locker, and an AI condition check flags the difference.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden px-4 py-20 sm:px-6 sm:py-28">
        <AuroraBackground intensity="medium" />
        <div className="relative mx-auto w-full max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex max-w-3xl flex-col gap-6"
          >
            <span className="inline-flex w-fit items-center gap-2 rounded-xs border border-[var(--brand-border)] bg-[var(--brand-surface)]/80 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--brand-primary)] backdrop-blur">
              <Sparkles size={13} />
              UCLM Engineering Thesis Platform
            </span>

            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              Student gear,{" "}
              <span className="bg-gradient-to-r from-[var(--brand-primary)] via-[var(--brand-secondary)] to-[var(--brand-accent)] bg-clip-text text-transparent">
                rented safely
              </span>{" "}
              through a smart locker.
            </h1>

            <p className="max-w-2xl text-lg text-[var(--brand-muted)]">
              EngiRent Hub connects a mobile app, an admin console, and an
              IoT kiosk into one controlled rental lifecycle — escrowed
              payment, camera-verified handover, and AI condition checks, so
              students can lend equipment to each other without the risk.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
              >
                Explore the architecture
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/about"
                className="inline-flex items-center gap-2 rounded-md border border-[var(--brand-border)] bg-[var(--brand-surface)] px-5 py-3 text-sm font-semibold transition-colors hover:border-[var(--brand-primary)]"
              >
                About the team
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
            className="mt-14 overflow-hidden rounded-md border border-[var(--brand-border)] bg-[var(--brand-surface)]/80 backdrop-blur"
          >
            {/* Column headers, hidden on mobile where each row stacks and
                carries its own inline labels instead. */}
            <div className="hidden grid-cols-[168px_1fr_1fr] gap-px bg-[var(--brand-border)] md:grid">
              <div className="bg-[var(--brand-soft)] px-5 py-2.5" />
              <div className="bg-[var(--brand-soft)] px-5 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-muted)]">
                Lending gear informally
              </div>
              <div className="bg-[var(--brand-soft)] px-5 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-primary)]">
                With EngiRent
              </div>
            </div>

            <div className="grid gap-px bg-[var(--brand-border)]">
              {COMPARISON.map((row) => (
                <div
                  key={row.stage}
                  className="grid gap-px bg-[var(--brand-border)] md:grid-cols-[168px_1fr_1fr]"
                >
                  <div className="flex items-center gap-2.5 bg-[var(--brand-surface)] px-5 py-4">
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-sm"
                      style={{
                        background: `color-mix(in srgb, ${row.accent} 14%, transparent)`,
                        color: row.accent,
                      }}
                    >
                      <row.icon size={15} />
                    </span>
                    <span className="text-sm font-bold">{row.stage}</span>
                  </div>

                  <div className="bg-[var(--brand-surface)] px-5 py-4">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-muted)] md:hidden">
                      Informally
                    </span>
                    <p className="text-sm text-[var(--brand-muted)] md:mt-0 mt-1">
                      {row.without}
                    </p>
                  </div>

                  <div className="bg-[var(--brand-surface)] px-5 py-4">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-primary)] md:hidden">
                      With EngiRent
                    </span>
                    <p className="text-sm md:mt-0 mt-1">{row.with}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <Section>
        <SectionHeading
          eyebrow="How it works"
          title="Six steps, one controlled lifecycle"
          description="Every stage is enforced by the system rather than by trust — this is the flow the thesis set out to make safe."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.06}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand-primary)]">
                    <step.icon size={18} />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--brand-muted)]">
                    Step {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold">{step.title}</h3>
                <p className="mt-1 text-sm text-[var(--brand-muted)]">{step.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-[var(--brand-border)] bg-[var(--brand-surface)] px-6 py-14 text-center sm:px-12">
            <AuroraBackground intensity="subtle" />
            <div className="relative flex flex-col items-center gap-4">
              <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
                Built for a campus, documented for a thesis
              </h2>
              <p className="max-w-xl text-[var(--brand-muted)]">
                The full system architecture, AI verification pipeline, and
                hardware design are written up in the technical docs.
              </p>
              <Link
                href="/docs"
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
              >
                Read the technical docs
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
