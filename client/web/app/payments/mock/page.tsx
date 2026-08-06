"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Stack, Text } from "@mantine/core";
import { title, subtitle } from "@/components/primitives";

// Shown inside the Phone App's WebView whenever the Node API has no
// PAYMONGO_SECRET_KEY configured (see createPayment in paymentController.ts)
// — a disposable-dev-database stand-in for a real PayMongo checkout, not
// something a production deployment with a real key ever reaches.
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
      <Alert color="danger" title="Missing transaction">
        No `tid` was provided — this page is only meant to be opened from the Phone App&apos;s
        checkout WebView.
      </Alert>
    );
  }

  return (
    <Card withBorder radius="lg" padding="xl" maw={480} mx="auto">
      <Stack gap="md">
        <div>
          <Text fw={700} size="lg">
            Mock Payment
          </Text>
          <Text size="sm" c="dimmed" mt={4}>
            No PayMongo sandbox key is configured on this dev backend, so checkout falls back to
            this page. Pick an outcome to simulate — it calls the same confirm endpoint a real
            PayMongo webhook would.
          </Text>
        </div>

        <Text size="xs" c="dimmed" ff="monospace">
          transaction: {tid}
        </Text>

        {error && (
          <Alert color="danger" title="Failed to resolve">
            {error}
          </Alert>
        )}

        {/* Stacked, not side-by-side (Group grow) — at the 390px width the
            Phone App's WebView actually renders this in, two same-row
            buttons clipped their own labels ("Simulate Succes[s]",
            "Simulate Failed [Payment]"), caught by screenshotting this page
            at that exact viewport rather than a wider desktop one. */}
        <Stack gap="xs">
          <Button
            color="emerald"
            fullWidth
            loading={loading === "success"}
            disabled={loading !== null}
            onClick={() => resolve("success")}
          >
            Simulate Successful Payment
          </Button>
          <Button
            color="danger"
            variant="outline"
            fullWidth
            loading={loading === "failure"}
            disabled={loading !== null}
            onClick={() => resolve("failure")}
          >
            Simulate Failed Payment
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}

export default function MockPaymentPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>Mock Checkout</h1>
        <p className={subtitle()}>Dev-only stand-in for a real PayMongo checkout session.</p>
      </header>
      <Suspense>
        <MockCheckout />
      </Suspense>
    </div>
  );
}
