import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { title, subtitle } from "@/components/primitives";

const tiers = [
  {
    name: "Student Basic",
    price: "PHP 0",
    desc: "Core access for student owners and renters.",
    bullets: [
      "Browse and list items",
      "Rental booking and timeline tracking",
      "Standard notifications",
    ],
  },
  {
    name: "Kiosk Transaction",
    price: "Per Rental",
    desc: "Operational fees tied to locker and verification usage.",
    bullets: [
      "QR + face kiosk access",
      "Deposit and return evidence capture",
      "AI verification processing",
    ],
    featured: true,
  },
  {
    name: "Admin Operations",
    price: "Institution Plan",
    desc: "Control layer for school administrators.",
    bullets: [
      "Monitoring and audit views",
      "Dispute and refund tooling",
      "Policy threshold management",
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>Pricing Model</h1>
        <p className={subtitle()}>
          EngiRent is designed for campus adoption. Core user access is free for
          students, while transaction and operations costs are tied to kiosk
          usage and institutional deployment.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {tiers.map((tier) => (
          <Card
            key={tier.name}
            className={`border ${
              tier.featured
                ? "border-[var(--brand-primary)] bg-[var(--brand-soft)]"
                : "border-[var(--brand-border)] bg-[var(--brand-surface)]"
            }`}
          >
            <CardBody className="space-y-3 p-5">
              {tier.featured && (
                <Chip
                  size="sm"
                  className="w-fit bg-[var(--brand-primary)] text-white"
                >
                  Recommended
                </Chip>
              )}
              <h2 className="text-xl font-bold text-[var(--brand-ink)]">
                {tier.name}
              </h2>
              <p className="text-sm font-semibold text-[var(--brand-primary)]">
                {tier.price}
              </p>
              <p className="text-sm text-[var(--brand-muted)]">{tier.desc}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--brand-muted)]">
                {tier.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
