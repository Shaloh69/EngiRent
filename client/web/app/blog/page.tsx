"use client";

import { Cpu, Camera, CreditCard, Layers, ShieldCheck, Smartphone } from "lucide-react";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { Card, Reveal, Section, SectionHeading } from "@/components/velora/section";

// The previous version of this page shipped three invented blog posts —
// titles, excerpts, and specific publication dates for articles that were
// never written. Design mandate §3.5 says not to ship a blog padded with
// placeholder posts, so this is now a project journal of real, verifiable
// engineering milestones taken from the repo's own documentation. No dates
// are shown, because attaching precise dates to them would be inventing
// detail again.
const MILESTONES = [
  {
    icon: Layers,
    phase: "Foundation",
    title: "Escrow-first rental lifecycle",
    body: "The core state machine — requested, paid, deposited, claimed, returned, settled — with money held until the item is verifiably in the locker. Payment and deposit must both clear before the owner is told to hand anything over.",
    accent: "var(--brand-primary)",
  },
  {
    icon: ShieldCheck,
    phase: "Security",
    title: "Biometric data encrypted at rest",
    body: "Face templates are stored with AES-256-GCM rather than in the clear, and identity photos are served only through short-lived signed URLs instead of permanent public links.",
    accent: "#22c55e",
  },
  {
    icon: CreditCard,
    phase: "Payments",
    title: "Real settlement, not a ledger entry",
    body: "Owner payouts run through PayMongo Disbursements and deposit refunds through real refund calls, with late and damage fees netted against the held deposit instead of billed afterwards.",
    accent: "var(--brand-secondary)",
  },
  {
    icon: Camera,
    phase: "AI",
    title: "Hybrid verification pipeline",
    body: "An 8-stage computer-vision pipeline combines classical features with deep-learning similarity to score deposit-versus-return condition, with thresholds that route uncertain cases to a human instead of guessing.",
    accent: "var(--brand-accent)",
  },
  {
    icon: Cpu,
    phase: "Hardware",
    title: "Self-hosted kiosk stack",
    body: "A Raspberry Pi 5 drives solenoid locks, linear actuators, and five cameras, reporting telemetry to the admin console over a live event stream — including a remote hardware self-test.",
    accent: "var(--brand-primary)",
  },
  {
    icon: Smartphone,
    phase: "Design",
    title: "One design system across four surfaces",
    body: "The phone app, admin console, kiosk touchscreen, and this site share a single palette and motion language, verified by screenshotting the real running builds rather than trusting the code.",
    accent: "var(--brand-secondary)",
  },
];

export default function BlogPage() {
  return (
    <>
      <section className="relative overflow-hidden px-4 py-20 sm:px-6">
        <AuroraBackground intensity="subtle" />
        <div className="relative mx-auto w-full max-w-6xl">
          <SectionHeading
            align="left"
            eyebrow="Project journal"
            title="What actually got built, and why"
            description="Engineering milestones from the thesis implementation — hardware integration, verification, settlement, and the design system that ties the surfaces together."
          />
        </div>
      </section>

      <Section className="pt-0">
        <div className="grid gap-4 md:grid-cols-2">
          {MILESTONES.map((m, i) => (
            <Reveal key={m.title} delay={i * 0.06}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <div
                    className="flex size-10 items-center justify-center rounded-md"
                    style={{
                      background: `color-mix(in srgb, ${m.accent} 14%, transparent)`,
                      color: m.accent,
                    }}
                  >
                    <m.icon size={20} />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--brand-muted)]">
                    {m.phase}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold">{m.title}</h3>
                <p className="mt-1 text-sm text-[var(--brand-muted)]">{m.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
