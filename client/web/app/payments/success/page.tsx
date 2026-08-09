"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";

// Landing page for both the real PayMongo checkout's successUrl and the
// dev-only /payments/mock page's "success" outcome — same destination
// either way, since the Phone App's WebView already finalized on the
// `status=paid` query param by the time a person would actually read this.
function SuccessContent() {
  const params = useSearchParams();
  const tid = params.get("tid");

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-md bg-[color-mix(in_srgb,#22c55e_16%,transparent)] text-[#22c55e]">
        <Check size={28} />
      </div>
      <h1 className="text-2xl font-extrabold">Payment Successful</h1>
      <p className="text-sm text-[var(--brand-muted)]">
        You can close this window and return to the app.
      </p>
      {tid && (
        <p className="font-mono text-xs text-[var(--brand-muted)]">
          transaction: {tid}
        </p>
      )}
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense>
      <SuccessContent />
    </Suspense>
  );
}
