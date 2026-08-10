"use client";

import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Badge, Card, Group, Select, Stack, Table, Text, ThemeIcon, Title } from "@mantine/core";
import { History, User as UserIcon } from "lucide-react";
import api from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { roleColor } from "../theme";

/**
 * Checklist Stage 9 — a real, structured, queryable audit trail. Before
 * this, "audit log" meant Winston text lines in logs/combined.log — not
 * structured, not queryable, and not reachable through any API. This is
 * the read side of the new AuditLog table.
 *
 * Also the fix for the login page's own copy, which claimed "every sign-in
 * is recorded against the audit log" — that was never actually built (this
 * table records admin *actions*, not login attempts) and the login page's
 * claim has been corrected to say so honestly instead.
 */

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  "item.unlist": "Unlisted an item",
  "item.relist": "Relisted an item",
  "item.flag": "Flagged an item",
  "item.unflag": "Unflagged an item",
  "item.restore": "Restored an item",
  "item.bulkUNLIST": "Bulk-unlisted items",
  "item.bulkRELIST": "Bulk-relisted items",
  "item.bulkFLAG": "Bulk-flagged items",
  "item.bulkUNFLAG": "Bulk-unflagged items",
  "idVerification.approve": "Approved an ID verification",
  "idVerification.reject": "Rejected an ID verification",
  "dispute.settle": "Settled a dispute",
  "user.update": "Updated a user",
  "user.createStaff": "Created a staff account",
  "review.delete": "Removed a review",
  "feedback.updateStatus": "Updated a feedback report",
  "kiosk.releaseLocker": "Released a locker",
};

const TARGET_TYPES = [
  { value: "item", label: "Item" },
  { value: "user", label: "User" },
  { value: "rental", label: "Rental" },
  { value: "review", label: "Review" },
  { value: "feedback", label: "Feedback" },
  { value: "kiosk", label: "Kiosk" },
];

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [targetType, setTargetType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (targetType) qs.set("targetType", targetType);
      const res = await api.get(`/admin/audit-log?${qs.toString()}`);
      setEntries(res.data?.data?.entries ?? []);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [targetType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Control"
          title="Audit Log"
          description="Every recorded admin action — who did what, to what, and why."
        />

        {error && (
          <Card withBorder radius="md" padding="md">
            <Text c={roleColor.critical} size="sm">{error}</Text>
          </Card>
        )}

        <DataTableCard
          columns={["Action", "Actor", "Target", "Reason", "When"]}
          loading={loading}
          isEmpty={entries.length === 0}
          filters={[
            {
              value: targetType,
              onChange: setTargetType,
              data: TARGET_TYPES,
              placeholder: "All target types",
            },
          ]}
          emptyState={
            <EmptyState
              icon={History}
              title="Nothing recorded yet"
              description="Admin actions will appear here as they happen."
            />
          }
        >
          {entries.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>
                <Text size="sm" fw={600}>{ACTION_LABELS[e.action] ?? e.action}</Text>
              </Table.Td>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  <ThemeIcon size={22} radius="xl" variant="light" color={roleColor.brand}>
                    <UserIcon size={12} />
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Text size="sm">{e.actorEmail}</Text>
                    <Badge size="xs" variant="outline" color={e.actorRole === "ADMIN" ? roleColor.accent : "gray"}>
                      {e.actorRole}
                    </Badge>
                  </Stack>
                </Group>
              </Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {e.targetType}
                  {e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ""}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed" lineClamp={1}>{e.reason || "—"}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{new Date(e.createdAt).toLocaleString()}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </DataTableCard>
      </Stack>
    </AdminLayout>
  );
}
