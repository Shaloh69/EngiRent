"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";

// Shown inside the Phone App's WebView whenever the Node API has no
// PAYMONGO_SECRET_KEY configured (see createPayment in paymentController.ts)
// — a dev stand-in for a real PayMongo checkout, not something a production
// deployment with a real key ever reaches.
function MockCheckout() {
  const router = useRouter();
  const params = useSearchParams();
  const tid = params.get("tid");
  const [loading, setLoading] = useState<"success" | "failure" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(outcome: "success" | "failure") {
    if (!tid) return;
    setLoading(outcome);
    setError(null);
    try {
      const resp = await fetch("/api/mock-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: tid, outcome }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.message || "Request failed");

      const dest = outcome === "success" ? "/payments/success" : "/payments/cancel";
      const status = outcome === "success" ? "paid" : "cancelled";
      router.replace(`${dest}?tid=${encodeURIComponent(tid)}&status=${status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(null);
    }
  }

  if (!tid) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
        <div className="flex gap-3 rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-soft)] p-5">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#ef4444]" />
          <p className="text-sm text-[var(--brand-muted)]">
            No <code>tid</code> was provided — this page is only meant to be
            opened from the Phone App&apos;s checkout WebView.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface)] p-6">
        <h1 className="text-lg font-extrabold">Mock Payment</h1>
        <p className="mt-1 text-sm text-[var(--brand-muted)]">
          No PayMongo sandbox key is configured on this backend, so checkout
          falls back to this page. Pick an outcome to simulate — it calls the
          same confirm endpoint a real PayMongo webhook would.
        </p>

        <p className="mt-4 font-mono text-xs text-[var(--brand-muted)]">
          transaction: {tid}
        </p>

        {error && (
          <p className="mt-4 rounded-xl bg-[color-mix(in_srgb,#ef4444_12%,transparent)] px-3 py-2 text-sm text-[#ef4444]">
            {error}
          </p>
        )}

        {/* Stacked, not side-by-side: at the 390px width the Phone App's
            WebView actually renders this in, two same-row buttons clipped
            their own labels. */}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => resolve("success")}
            className="w-full rounded-xl bg-[#22c55e] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading === "success" ? "Processing…" : "Simulate Successful Payment"}
          </button>
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => resolve("failure")}
            className="w-full rounded-xl border border-[#ef4444] px-4 py-3 text-sm font-semibold text-[#ef4444] disabled:opacity-60"
          >
            {loading === "failure" ? "Processing…" : "Simulate Failed Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MockPaymentPage() {
  return (
    <Suspense>
      <MockCheckout />
    </Suspense>
  );
}
