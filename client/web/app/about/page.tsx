"use client";

import { Cpu, GraduationCap, Layers, Radio, ShieldCheck, Smartphone } from "lucide-react";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { Card, Reveal, Section, SectionHeading } from "@/components/velora/section";

const SURFACES = [
  {
    icon: Smartphone,
    title: "Phone App",
    body: "Flutter. Browse and list items, book rentals, pay, and unlock lockers with a QR token plus face verification.",
  },
  {
    icon: Layers,
    title: "Admin Console",
    body: "Next.js + Mantine. Rental lifecycle, dispute queue, payment ledger, kiosk telemetry, and system health.",
  },
  {
    icon: Cpu,
    title: "Smart Kiosk",
    body: "Raspberry Pi 5 driving solenoid locks, linear actuators, and five cameras, with a React touchscreen UI.",
  },
  {
    icon: Radio,
    title: "AI Service",
    body: "FastAPI running an 8-stage hybrid computer-vision pipeline that scores deposit-versus-return condition.",
  },
];

const PRINCIPLES = [
  {
    title: "Trust is enforced, not assumed",
    body: "Payment is escrowed and handover is camera-verified, so neither student has to take the other at their word.",
  },
  {
    title: "Evidence over recollection",
    body: "Condition disputes are settled against timestamped images captured at the locker, not competing memories.",
  },
  {
    title: "Nobody has to staff it",
    body: "Identity checks, locker control, and settlement all run without a person mediating the exchange.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden px-4 py-20 sm:px-6">
        <AuroraBackground intensity="subtle" />
        <div className="relative mx-auto w-full max-w-6xl">
          <SectionHeading
            align="left"
            eyebrow="About"
            title="A thesis project about making peer-to-peer rental safe"
            description="EngiRent Hub is an undergraduate engineering thesis at the University of Cebu Lapu-Lapu and Mandaue. It tackles a specific problem: students own equipment other students need for a week, but lending it means trusting a stranger with something expensive."
          />
        </div>
      </section>

      <Section className="pt-0">
        <SectionHeading
          eyebrow="Architecture"
          title="Four surfaces, one lifecycle"
          description="Each surface owns a distinct part of the rental flow and talks to the same API and database."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {SURFACES.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.06}>
              <Card className="h-full">
                <div className="flex size-10 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand-primary)]">
                  <s.icon size={20} />
                </div>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-1 text-sm text-[var(--brand-muted)]">{s.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <SectionHeading
          eyebrow="Design principles"
          title="What the system refuses to leave to chance"
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.06}>
              <Card className="h-full">
                <ShieldCheck size={19} className="text-[var(--brand-secondary)]" />
                <h3 className="mt-3 text-base font-bold">{p.title}</h3>
                <p className="mt-1 text-sm text-[var(--brand-muted)]">{p.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <Reveal>
          <Card className="flex flex-col items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand-primary)]">
              <GraduationCap size={20} />
            </div>
            <h3 className="text-xl font-bold">Academic context</h3>
            <p className="max-w-3xl text-sm text-[var(--brand-muted)]">
              Built as a capstone engineering thesis covering embedded hardware,
              computer vision, payment integration, and full-stack development.
              The kiosk hardware, the verification pipeline, and the escrow
              settlement logic were each designed, implemented, and evaluated as
              part of the study.
            </p>
          </Card>
        </Reveal>
      </Section>
    </>
  );
}
