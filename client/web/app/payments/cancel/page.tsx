"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";

// Landing page for both the real PayMongo checkout's cancelUrl and the
// dev-only /payments/mock page's "failure" outcome.
function CancelContent() {
  const params = useSearchParams();
  const tid = params.get("tid");

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-md bg-[color-mix(in_srgb,#ef4444_14%,transparent)] text-[#ef4444]">
        <X size={28} />
      </div>
      <h1 className="text-2xl font-extrabold">Payment Not Completed</h1>
      <p className="text-sm text-[var(--brand-muted)]">
        The payment was cancelled or failed. You can close this window and try
        again from the app.
      </p>
      {tid && (
        <p className="font-mono text-xs text-[var(--brand-muted)]">
          transaction: {tid}
        </p>
      )}
    </div>
  );
}

export default function PaymentCancelPage() {
  return (
    <Suspense>
      <CancelContent />
    </Suspense>
  );
}
