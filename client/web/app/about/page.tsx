import { Card, CardBody } from "@heroui/card";
import { title, subtitle } from "@/components/primitives";

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>About EngiRent Hub</h1>
        <p className={subtitle()}>
          EngiRent Hub is an IoT-powered rental platform developed for UCLM
          Engineering students to access academic tools affordably while
          reducing risks from informal peer-to-peer borrowing.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border border-[var(--brand-border)] bg-[var(--brand-surface)] lg:col-span-2">
          <CardBody className="space-y-3 p-5 sm:p-6">
            <h2 className="text-lg font-bold text-[var(--brand-ink)]">
              Project Intent
            </h2>
            <p className="text-sm leading-relaxed text-[var(--brand-muted)]">
              Build a complete end-to-end flow where trust is enforced by system
              controls: identity verification, kiosk automation, payment
              hold/release logic, and machine-assisted item validation on
              deposit and return.
            </p>
            <p className="text-sm leading-relaxed text-[var(--brand-muted)]">
              The architecture combines Flutter mobile clients, a Node.js
              backend as source of truth, a Python vision service, and admin
              monitoring tools for disputes, policy enforcement, and operations.
            </p>
          </CardBody>
        </Card>
        <Card
          id="contact"
          className="border border-[var(--brand-border)] bg-[var(--brand-soft)]"
        >
          <CardBody className="space-y-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-muted)]">
              Contact
            </p>
            <p className="text-sm font-semibold text-[var(--brand-ink)]">
              Engineering Thesis Team
            </p>
            <p className="text-sm text-[var(--brand-muted)]">
              University of Cebu Lapu-Lapu and Mandaue
            </p>
            <p className="text-sm text-[var(--brand-muted)]">
              support@engirenthub.com
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
