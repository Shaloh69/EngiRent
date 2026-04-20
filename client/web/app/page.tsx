import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Link } from "@heroui/link";
import { title, subtitle } from "@/components/primitives";

const features = [
  {
    icon: "MB",
    name: "Mobile Booking",
    text: "Students browse listings, schedule rentals, and track each stage in real-time.",
  },
  {
    icon: "QR",
    name: "Kiosk QR + Face",
    text: "Owner and renter actions are gated by short-lived QR tokens and face verification.",
  },
  {
    icon: "AI",
    name: "AI Verification",
    text: "Deposit and return photos are evaluated by the ML service for identity and condition checks.",
  },
  {
    icon: "SC",
    name: "Escrow-Controlled Payout",
    text: "Rental payment release/refund follows verification and policy rules to reduce disputes.",
  },
];

export default function Home() {
  return (
    <section className="space-y-8 pb-6 sm:space-y-12">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="space-y-5">
          <Chip
            size="sm"
            variant="flat"
            className="border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-primary)]"
          >
            UCLM Engineering Thesis Platform
          </Chip>
          <h1 className={title({ size: "lg", fullWidth: true })}>
            Smart, Secure Student
            <br />
            <span className={title({ color: "primary", size: "lg" })}>
              Rental Workflows
            </span>
          </h1>
          <p className={subtitle()}>
            EngiRent Hub connects mobile users, admin operations, and kiosk
            automation into one controlled rental lifecycle: listing, escrow
            payment, deposit verification, pickup, return checks, and
            completion.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              as={Link}
              href="/docs"
              className="font-semibold text-white"
              style={{ background: "var(--brand-primary)" }}
            >
              Explore Architecture
            </Button>
            <Button
              as={Link}
              href="/about"
              variant="bordered"
              className="border-[var(--brand-border)] font-semibold text-[var(--brand-ink)]"
            >
              About the Team
            </Button>
          </div>
        </div>

        <Card className="border border-[var(--brand-border)] bg-[var(--brand-surface)] shadow-[0_12px_34px_rgba(25,55,117,0.12)]">
          <CardBody className="space-y-4 p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-muted)]">
              Current Focus
            </p>
            <h2 className="text-2xl font-extrabold text-[var(--brand-ink)]">
              End-to-End Kiosk Transaction Reliability
            </h2>
            <ul className="space-y-3 text-sm text-[var(--brand-muted)]">
              <li className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-soft)] px-4 py-3">
                Payment stays in escrow until owner deposit is verified.
              </li>
              <li className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-soft)] px-4 py-3">
                Pickup and return require QR + face validation for both parties.
              </li>
              <li className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-soft)] px-4 py-3">
                Admin receives monitoring feeds for disputes, penalties, and
                fallback handling.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {features.map((feature) => (
          <Card
            key={feature.name}
            className="border border-[var(--brand-border)] bg-[var(--brand-surface)]"
          >
            <CardBody className="space-y-3 p-5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-primary)]">
                <span className="text-xs font-extrabold">{feature.icon}</span>
              </span>
              <p className="text-base font-bold text-[var(--brand-ink)]">
                {feature.name}
              </p>
              <p className="text-sm leading-relaxed text-[var(--brand-muted)]">
                {feature.text}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}
