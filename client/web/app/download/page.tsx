import type { Metadata } from "next";
import NextLink from "next/link";
import { Download, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { Section, SectionHeading, Card, Reveal } from "@/components/velora/section";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { androidRelease } from "@/config/release";

export const metadata: Metadata = {
  title: "Download the app",
  description:
    "Download the EngiRent Hub Android app — the current pre-release build for UCLM students.",
};

const steps = [
  {
    title: "Allow install from this browser",
    body: "Android blocks APKs from outside the Play Store by default. When prompted, open Settings and allow your browser to install unknown apps.",
  },
  {
    title: "Open the downloaded file",
    body: "Tap the file from your notifications or your Downloads folder, then confirm the install.",
  },
  {
    title: "Sign in with your UCLM account",
    body: "Use your student email. If you don't have an account yet, create one from the sign-in screen.",
  },
];

export default function DownloadPage() {
  const { version, buildNumber, released, sizeMb, minAndroid, highlights } =
    androidRelease;

  return (
    <>
      <Section className="relative overflow-hidden">
        <AuroraBackground intensity="medium" />
        <div className="relative grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div className="flex flex-col items-start gap-5">
            <SectionHeading
              align="left"
              eyebrow="Android · Pre-release"
              title="Get the EngiRent Hub app"
              description="Rent and lend equipment, and open the smart locker from your phone. Currently distributed directly rather than through the Play Store."
            />

            {/* Routes into /downloading rather than linking the file
                directly — that page runs the actual fetch (so it can show
                real byte progress, not a spinner) and is where the
                block-assembly transition and the pre-install disclaimer
                live now. */}
            <NextLink
              href="/downloading"
              className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-primary)] px-6 py-3.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
            >
              <Download size={18} />
              Download APK
              {/* Mandate §1.2 — version/size are identifier-like, so mono. */}
              <span className="font-mono text-xs font-normal opacity-80">
                v{version} · {sizeMb} MB
              </span>
            </NextLink>

            <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-2">
              {[
                { label: "Version", value: `${version} (build ${buildNumber})` },
                { label: "Released", value: released },
                { label: "Requires", value: `Android ${minAndroid}` },
              ].map((m) => (
                <div key={m.label} className="flex flex-col gap-0.5">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand-muted)]">
                    {m.label}
                  </dt>
                  <dd className="font-mono text-sm font-semibold">{m.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <Reveal>
            <Card className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Smartphone size={18} className="text-[var(--brand-primary)]" />
                <h3 className="text-lg font-bold">What&apos;s new in {version}</h3>
              </div>
              <ul className="flex flex-col gap-2.5">
                {highlights.map((h) => (
                  <li key={h} className="flex gap-2.5 text-sm text-[var(--brand-muted)]">
                    <span
                      aria-hidden
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]"
                    />
                    {h}
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        </div>
      </Section>

      <Section className="pt-0">
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.06}>
              <Card className="h-full">
                <span className="font-mono text-xs font-semibold text-[var(--brand-primary)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 text-base font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-[var(--brand-muted)]">{s.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card className="flex gap-3">
            <TriangleAlert
              size={18}
              className="mt-0.5 shrink-0 text-[var(--brand-accent)]"
            />
            <div>
              <h3 className="text-sm font-bold">This is a pre-release build</h3>
              <p className="mt-1 text-sm text-[var(--brand-muted)]">
                It is distributed for thesis evaluation, not published on the Play
                Store. Expect rough edges, and report anything broken to the team.
              </p>
            </div>
          </Card>
          <Card className="flex gap-3">
            <ShieldCheck
              size={18}
              className="mt-0.5 shrink-0 text-[var(--brand-primary)]"
            />
            <div>
              <h3 className="text-sm font-bold">Signed by the EngiRent team</h3>
              <p className="mt-1 text-sm text-[var(--brand-muted)]">
                Every build is signed with the project&apos;s release key, so Android
                will only install an update that came from the same source.
              </p>
            </div>
          </Card>
        </div>
      </Section>
    </>
  );
}
