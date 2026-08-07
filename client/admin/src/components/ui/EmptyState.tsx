"use client";

import { Center, Stack, Text, ThemeIcon } from "@mantine/core";
import type { LucideIcon } from "lucide-react";

// Used instead of removing a component when there's no data. The mandate
// treats a missing component as a fail condition and an empty state as
// acceptable — so tables/cards keep their structure and explain the gap
// rather than collapsing to nothing.
export function EmptyState({
  icon: Icon,
  title,
  description,
  minHeight = 180,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  minHeight?: number;
}) {
  return (
    <Center mih={minHeight}>
      <Stack align="center" gap={6}>
        <ThemeIcon size={44} radius="xl" variant="light" color="teal">
          <Icon size={22} />
        </ThemeIcon>
        <Text fw={600} size="sm">
          {title}
        </Text>
        {description && (
          <Text size="xs" c="dimmed" ta="center" maw={280}>
            {description}
          </Text>
        )}
      </Stack>
    </Center>
  );
}
