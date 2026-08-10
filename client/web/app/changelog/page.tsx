import type { Metadata } from "next";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { Card, Reveal, Section, SectionHeading } from "@/components/velora/section";
import { changelog, changelogTagLabel, type ChangelogTag } from "@/config/changelog";
import { androidRelease } from "@/config/release";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Every real, dated milestone in the EngiRent Hub build — sourced directly from the project's own engineering log.",
};

// Tag → accent color, reusing the three brand hues rather than inventing a
// fourth palette just for this page. "infra" gets no color at all (muted,
// outlined) since it's the least visible-to-a-renter category.
const tagColor: Record<ChangelogTag, string> = {
  release: "var(--brand-primary)",
  feature: "var(--brand-secondary)",
  fix: "#dc2626",
  design: "var(--brand-accent)",
  infra: "var(--brand-muted)",
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function ChangelogPage() {
  return (
    <>
      <Section className="relative overflow-hidden pb-10">
        <AuroraBackground intensity="subtle" />
        <div className="relative">
          <SectionHeading
            align="left"
            eyebrow={`Revision history · currently rev ${androidRelease.version}`}
            title="Changelog"
            description="Every entry below is a real, dated milestone from this project's own build log — not marketing copy written after the fact."
          />
        </div>
      </Section>

      <Section className="pt-0">
        {/* Revision-history rail: a ruled mono date column plus a connecting
            line, echoing the title block's "Rev"/"Sheet" cells elsewhere on
            this site rather than a generic card grid. */}
        <ol className="relative flex flex-col gap-8 border-l border-[var(--brand-border)] pl-6 sm:pl-8">
          {changelog.map((entry, i) => (
            <Reveal key={`${entry.date}-${entry.title}`} delay={i * 0.04}>
              <li className="relative">
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-[calc(1.5rem+5px)] size-[9px] rounded-full ring-4 ring-[var(--brand-bg)] sm:-left-[calc(2rem+5px)]"
                  style={{ background: tagColor[entry.tag] }}
                />

                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <time
                    dateTime={entry.date}
                    className="font-mono text-xs font-semibold tracking-wide text-[var(--brand-muted)]"
                  >
                    {dateFmt.format(new Date(entry.date))}
                  </time>
                  <span
                    className="inline-flex items-center rounded-xs border px-2 py-0.5 text-[10px] font-bold tracking-[0.14em] uppercase"
                    style={{
                      color: tagColor[entry.tag],
                      borderColor: `color-mix(in srgb, ${tagColor[entry.tag]} 35%, transparent)`,
                      background: `color-mix(in srgb, ${tagColor[entry.tag]} 10%, transparent)`,
                    }}
                  >
                    {changelogTagLabel[entry.tag]}
                  </span>
                  {entry.version && (
                    <span className="font-mono text-[11px] font-bold text-[var(--brand-ink)]">
                      v{entry.version}
                    </span>
                  )}
                </div>

                <Card className="hover:shadow-none">
                  <h3 className="text-base font-bold sm:text-lg">{entry.title}</h3>
                  <ul className="mt-3 flex flex-col gap-2">
                    {entry.bullets.map((b) => (
                      <li key={b} className="flex gap-2.5 text-sm text-[var(--brand-muted)]">
                        <span
                          aria-hidden
                          className="mt-1.5 size-1.5 shrink-0 rounded-full"
                          style={{ background: tagColor[entry.tag] }}
                        />
                        {b}
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            </Reveal>
          ))}

          <li className="relative">
            <span
              aria-hidden
              className="absolute top-1.5 -left-[calc(1.5rem+5px)] size-[9px] rounded-full bg-[var(--brand-border)] ring-4 ring-[var(--brand-bg)] sm:-left-[calc(2rem+5px)]"
            />
            <p className="font-mono text-xs text-[var(--brand-muted)]">
              Start of project — see{" "}
              <a href="/blog" className="text-[var(--brand-primary)] underline underline-offset-2">
                the project journal
              </a>{" "}
              for the engineering milestones behind these dates.
            </p>
          </li>
        </ol>
      </Section>
    </>
  );
}
