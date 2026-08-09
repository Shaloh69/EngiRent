"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-md bg-[color-mix(in_srgb,#ef4444_14%,transparent)] text-[#ef4444]">
        <AlertTriangle size={24} />
      </div>
      <h1 className="text-2xl font-extrabold">Something went wrong</h1>
      <p className="text-sm text-[var(--brand-muted)]">
        We could not render this section. Retry the action or return to the
        previous page.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-md bg-[var(--brand-primary)] px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
      >
        Try again
      </button>
    </div>
  );
}
