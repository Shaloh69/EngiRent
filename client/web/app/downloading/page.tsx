"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { CheckCircle2, Download, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { BlockAssembly } from "@/components/velora/block-assembly";
import { Card, Section } from "@/components/velora/section";
import { androidRelease, androidDownloadPath } from "@/config/release";

/**
 * The download button on /download used to point straight at the APK's
 * static URL — a fine, standard pattern, but it gave nothing back: no
 * confirmation the file actually arrived, no disclaimer at the moment that
 * matters (right before someone installs a pre-release build), and nowhere
 * for the block-assembly transition (previously kiosk-only) to live.
 *
 * This page fetches the same file the old link pointed at, but through the
 * page's own JS so real byte progress is available — no simulated
 * percentage. `response.body` is same-origin (the file is served from this
 * app's own /public/downloads), so Content-Length is readable without a
 * CORS workaround.
 */

type Phase = "transition" | "downloading" | "done" | "error";

export default function DownloadingPage() {
  const [phase, setPhase] = useState<Phase>("transition");
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  const startDownload = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(androidDownloadPath, { signal: controller.signal });
      if (!res.ok || !res.body) {
        throw new Error(`Server responded ${res.status}`);
      }

      const lengthHeader = res.headers.get("content-length");
      setTotal(lengthHeader ? Number(lengthHeader) : null);

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedBytes += value.length;
          setReceived(receivedBytes);
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: "application/vnd.android.package-archive" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = androidRelease.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked after a tick, not immediately — some browsers still need the
      // object URL alive to actually start the save.
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      setPhase("done");
    } catch (err) {
      if (controller.signal.aborted) return; // user cancelled — not an error
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (phase === "downloading") void startDownload();
  }, [phase, startDownload]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleCancel = () => {
    abortRef.current?.abort();
    setPhase("error");
    setErrorMessage("Download cancelled.");
  };

  // window.close() only works on a tab the script itself opened — a normal
  // top-level navigation (the common case here) makes it a silent no-op.
  // Tried anyway as a best effort; the button's own label doesn't promise
  // it'll work, since it often can't.
  const handleClose = () => {
    try {
      window.close();
    } catch {
      /* no-op — see comment above */
    }
  };

  const pct = total ? Math.min(100, Math.round((received / total) * 100)) : null;
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);

  return (
    <>
      {phase === "transition" && (
        <BlockAssembly runKey="downloading-boot" boot onFinished={() => setPhase("downloading")} />
      )}

      <Section className="relative flex min-h-[70vh] items-center overflow-hidden">
        <AuroraBackground intensity="medium" />
        <div className="relative mx-auto w-full max-w-lg">
          <Card className="flex flex-col items-center gap-5 text-center">
            {(phase === "transition" || phase === "downloading") && (
              <>
                <div className="flex size-14 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] text-[var(--brand-primary)]">
                  <Download size={26} className="animate-bounce" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Downloading EngiRent Hub</h1>
                  <p className="mt-1 font-mono text-xs text-[var(--brand-muted)]">
                    v{androidRelease.version} · build {androidRelease.buildNumber}
                  </p>
                </div>

                <div className="w-full">
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--brand-soft)]">
                    <div
                      className="h-full rounded-full bg-[var(--brand-primary)] transition-[width] duration-200 ease-out"
                      style={{
                        width: pct !== null ? `${pct}%` : phase === "downloading" ? "18%" : "0%",
                      }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[11px] text-[var(--brand-muted)]">
                    <span>
                      {phase === "downloading"
                        ? total
                          ? `${mb(received)} / ${mb(total)} MB`
                          : `${mb(received)} MB`
                        : "Preparing…"}
                    </span>
                    <span>{pct !== null ? `${pct}%` : ""}</span>
                  </div>
                </div>

                {phase === "downloading" && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="text-xs font-semibold text-[var(--brand-muted)] underline underline-offset-2 hover:text-[var(--brand-ink)]"
                  >
                    Cancel
                  </button>
                )}
              </>
            )}

            {phase === "done" && (
              <>
                <div className="flex size-14 items-center justify-center rounded-md bg-[color-mix(in_srgb,#22c55e_14%,transparent)] text-[#22c55e]">
                  <CheckCircle2 size={28} />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Thank you for downloading EngiRent Hub!</h1>
                  <p className="mt-1.5 text-sm text-[var(--brand-muted)]">
                    v{androidRelease.version} saved to your device. Open the file from your
                    downloads to install it.
                  </p>
                </div>

                <div className="w-full rounded-md border border-[var(--brand-border)] bg-[var(--brand-soft)] p-4 text-left">
                  <div className="flex gap-2.5">
                    <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--brand-accent)]" />
                    <p className="text-xs text-[var(--brand-muted)]">
                      <strong className="text-[var(--brand-ink)]">This is a pre-release build</strong>{" "}
                      distributed for thesis evaluation, not published on the Play Store. Android
                      will warn you before installing an app from outside the Store — that&apos;s
                      expected. Expect rough edges, and report anything broken to the team.
                    </p>
                  </div>
                  <div className="mt-3 flex gap-2.5">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--brand-primary)]" />
                    <p className="text-xs text-[var(--brand-muted)]">
                      Signed with the project&apos;s own release key, so Android will only ever
                      install an update that came from the same source as this one.
                    </p>
                  </div>
                </div>

                <div className="flex w-full flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 rounded-md bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
                  >
                    Close this tab
                  </button>
                  <NextLink
                    href="/"
                    className="flex-1 rounded-md border border-[var(--brand-border)] px-4 py-2.5 text-sm font-bold transition-colors hover:bg-[var(--brand-soft)]"
                  >
                    Back to site
                  </NextLink>
                </div>
                <p className="text-[11px] text-[var(--brand-muted)]">
                  If &quot;Close this tab&quot; doesn&apos;t do anything, your browser only allows
                  that for tabs it opened itself — the download is already saved either way, so
                  it&apos;s safe to just navigate away.
                </p>
              </>
            )}

            {phase === "error" && (
              <>
                <div className="flex size-14 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--brand-accent)_14%,transparent)] text-[var(--brand-accent)]">
                  <XCircle size={28} />
                </div>
                <div>
                  <h1 className="text-xl font-bold">
                    {errorMessage === "Download cancelled." ? "Download cancelled" : "The download didn't finish"}
                  </h1>
                  <p className="mt-1.5 text-sm text-[var(--brand-muted)]">{errorMessage}</p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => {
                      startedRef.current = false;
                      setReceived(0);
                      setTotal(null);
                      setPhase("downloading");
                    }}
                    className="flex-1 rounded-md bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
                  >
                    Try again
                  </button>
                  <a
                    href={androidDownloadPath}
                    download
                    className="flex-1 rounded-md border border-[var(--brand-border)] px-4 py-2.5 text-center text-sm font-bold transition-colors hover:bg-[var(--brand-soft)]"
                  >
                    Direct link instead
                  </a>
                </div>
              </>
            )}
          </Card>
        </div>
      </Section>
    </>
  );
}
