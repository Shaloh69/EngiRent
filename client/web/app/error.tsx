"use client";

import { useEffect } from "react";
import { Button, Card, Text } from "@mantine/core";

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
    <Card withBorder radius="lg" padding="xl" maw={480} mx="auto" ta="center">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
        Unexpected Error
      </Text>
      <Text size="xl" fw={800} mt={4}>
        Something went wrong
      </Text>
      <Text size="sm" c="dimmed" mt="sm">
        We could not render this section. Retry the action or return to the
        previous page.
      </Text>
      <Button color="violet" mt="lg" onClick={reset}>
        Try again
      </Button>
    </Card>
  );
}
