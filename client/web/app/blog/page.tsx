import { Card, CardBody } from "@heroui/card";
import { title, subtitle } from "@/components/primitives";

const posts = [
  {
    title: "Designing a Safe Student Rental Lifecycle",
    excerpt:
      "Why escrow states, identity checks, and kiosk evidence capture need to work as one system.",
    date: "2026-02-10",
  },
  {
    title: "AI Verification for Deposit and Return Events",
    excerpt:
      "How confidence-driven decisions reduce manual review while keeping admins in control.",
    date: "2026-01-28",
  },
  {
    title: "From Informal Borrowing to Accountable Automation",
    excerpt:
      "Mapping thesis survey pain points into concrete product workflows.",
    date: "2026-01-16",
  },
];

export default function BlogPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>Project Journal</h1>
        <p className={subtitle()}>
          Notes from the implementation journey across hardware integration,
          software orchestration, and student-user validation.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {posts.map((post) => (
          <Card
            key={post.title}
            className="border border-[var(--brand-border)] bg-[var(--brand-surface)]"
          >
            <CardBody className="space-y-3 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-muted)]">
                {post.date}
              </p>
              <h2 className="text-lg font-bold text-[var(--brand-ink)]">
                {post.title}
              </h2>
              <p className="text-sm text-[var(--brand-muted)]">
                {post.excerpt}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
