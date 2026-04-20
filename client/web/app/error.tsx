"use client";

import { useEffect } from "react";
import { Button } from "@heroui/button";

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
    <div className="mx-auto max-w-lg rounded-3xl border border-[var(--brand-border)] bg-[var(--brand-surface)] p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-muted)]">
        Unexpected Error
      </p>
      <h2 className="mt-2 text-2xl font-extrabold text-[var(--brand-ink)]">
        Something went wrong
      </h2>
      <p className="mt-3 text-sm text-[var(--brand-muted)]">
        We could not render this section. Retry the action or return to the
        previous page.
      </p>
      <Button
        className="mt-5 font-semibold text-white"
        style={{ background: "var(--brand-primary)" }}
        onPress={reset}
      >
        Try again
      </Button>
    </div>
  );
}
