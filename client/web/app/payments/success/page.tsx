"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, Stack, Text, ThemeIcon } from "@mantine/core";
import { title, subtitle } from "@/components/primitives";

// Landing page for both the real PayMongo checkout's successUrl and the
// dev-only /payments/mock page's "success" outcome — same destination
// either way, since the Phone App's WebView already finalized on the
// `status=paid` query param by the time a person would actually read this.
function SuccessContent() {
  const params = useSearchParams();
  const tid = params.get("tid");

  return (
    <Card withBorder radius="lg" padding="xl" maw={480} mx="auto">
      <Stack align="center" gap="sm">
        <ThemeIcon color="emerald" size={56} radius="xl">
          <Text size="xl" fw={700}>
            ✓
          </Text>
        </ThemeIcon>
        <Text fw={700} size="lg">
          Payment Successful
        </Text>
        <Text size="sm" c="dimmed" ta="center">
          You can close this window and return to the app.
        </Text>
        {tid && (
          <Text size="xs" c="dimmed" ff="monospace">
            transaction: {tid}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

export default function PaymentSuccessPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>Payment Successful</h1>
        <p className={subtitle()}>Your payment has been recorded.</p>
      </header>
      <Suspense>
        <SuccessContent />
      </Suspense>
    </div>
  );
}
