"use client";

import { Camera, KeyRound, PackageCheck, ShieldCheck } from "lucide-react";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { Card, Reveal, Section, SectionHeading } from "@/components/velora/section";

// Content carried forward from the previous docs page (design mandate §3.5
// calls it out as genuinely accurate and says to keep it rather than
// discard it), with one correction: the renter flow said "GCash payment",
// but the confirmed payment stack is PayMongo — GCash is one of the methods
// PayMongo exposes, not the integration itself.
const SECTIONS = [
  {
    id: "owner-flow",
    title: "Owner Flow",
    icon: PackageCheck,
    accent: "var(--brand-primary)",
    steps: [
      "Create listing with photos, pricing, and schedule.",
      "Receive deposit request after renter payment is held.",
      "Complete QR + face auth at kiosk and deposit item.",
      "Get payout when deposit verification passes.",
      "Retrieve item after return verification and close rental.",
    ],
  },
  {
    id: "renter-flow",
    title: "Renter Flow",
    icon: KeyRound,
    accent: "var(--brand-secondary)",
    steps: [
      "Browse and reserve item from mobile app.",
      "Pay via PayMongo and wait for the owner to deposit.",
      "Receive pickup notification with QR token.",
      "Use QR + face auth at kiosk to claim item.",
      "Return item via kiosk before due time.",
    ],
  },
  {
    id: "verification",
    title: "Verification Pipeline",
    icon: Camera,
    accent: "var(--brand-accent)",
    steps: [
      "Kiosk captures images at deposit and return.",
      "Node backend submits evidence to Python AI service.",
      "AI returns confidence scores and decision hints.",
      "Backend applies policy thresholds and transitions rental state.",
      "Admin can manually review flagged results.",
    ],
  },
  {
    id: "security",
    title: "Security Controls",
    icon: ShieldCheck,
    accent: "#22c55e",
    steps: [
      "Short-lived rental-specific QR tokens.",
      "Face verification linked to enrolled user profile.",
      "Audit logs for admin actions and kiosk events.",
      "Role-based control for admin-only operations.",
      "Policy-driven refund, dispute, and penalty handling.",
    ],
  },
];

export default function DocsPage() {
  return (
    <>
      <section className="relative overflow-hidden px-4 py-20 sm:px-6">
        <AuroraBackground intensity="subtle" />
        <div className="relative mx-auto w-full max-w-6xl">
          <SectionHeading
            align="left"
            eyebrow="Technical docs"
            title="How the rental lifecycle actually runs"
            description="The four flows that make up the system, from listing an item through to settlement — including what the AI checks and what stops an unauthorised locker opening."
          />
        </div>
      </section>

      <Section className="pt-0">
        <div className="grid gap-4 lg:grid-cols-2">
          {SECTIONS.map((s, i) => (
            <Reveal key={s.id} delay={i * 0.06}>
              <Card id={s.id} className="h-full">
                <div className="flex items-center gap-3">
                  <div
                    className="flex size-10 items-center justify-center rounded-xl"
                    style={{
                      background: `color-mix(in srgb, ${s.accent} 14%, transparent)`,
                      color: s.accent,
                    }}
                  >
                    <s.icon size={20} />
                  </div>
                  <h3 className="text-lg font-bold">{s.title}</h3>
                </div>

                <ol className="mt-5 space-y-3">
                  {s.steps.map((step, n) => (
                    <li key={step} className="flex gap-3">
                      <span
                        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                        style={{
                          background: `color-mix(in srgb, ${s.accent} 14%, transparent)`,
                          color: s.accent,
                        }}
                      >
                        {n + 1}
                      </span>
                      <span className="text-sm text-[var(--brand-muted)]">{step}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
