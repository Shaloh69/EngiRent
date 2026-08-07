"use client";

import { Button, Group, Stack, Text, Title } from "@mantine/core";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  onRefresh,
  refreshing,
  actions,
}: PageHeaderProps) {
  return (
    <Group justify="space-between" wrap="wrap" align="flex-start">
      <Stack gap={2}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
          {eyebrow}
        </Text>
        <Title order={1} size="h2">
          {title}
        </Title>
        {description && (
          <Text size="sm" c="dimmed" maw={640}>
            {description}
          </Text>
        )}
      </Stack>
      <Group gap="xs">
        {actions}
        {onRefresh && (
          <Button
            variant="light"
            leftSection={<RefreshCw size={16} />}
            onClick={onRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
        )}
      </Group>
    </Group>
  );
}
