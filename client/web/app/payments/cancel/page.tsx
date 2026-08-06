"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, Stack, Text, ThemeIcon } from "@mantine/core";
import { title, subtitle } from "@/components/primitives";

// Landing page for both the real PayMongo checkout's cancelUrl and the
// dev-only /payments/mock page's "failure" outcome.
function CancelContent() {
  const params = useSearchParams();
  const tid = params.get("tid");

  return (
    <Card withBorder radius="lg" padding="xl" maw={480} mx="auto">
      <Stack align="center" gap="sm">
        <ThemeIcon color="danger" size={56} radius="xl">
          <Text size="xl" fw={700}>
            ✕
          </Text>
        </ThemeIcon>
        <Text fw={700} size="lg">
          Payment Not Completed
        </Text>
        <Text size="sm" c="dimmed" ta="center">
          The payment was cancelled or failed. You can close this window and try again from the
          app.
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

export default function PaymentCancelPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>Payment Not Completed</h1>
        <p className={subtitle()}>The payment was cancelled or failed.</p>
      </header>
      <Suspense>
        <CancelContent />
      </Suspense>
    </div>
  );
}
