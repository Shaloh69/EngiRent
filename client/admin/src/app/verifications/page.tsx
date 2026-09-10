"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  ActionIcon,
  Alert,
  Anchor,
  Card,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ScanFace,
  ThumbsDown,
  ThumbsUp,
  TimerReset,
} from "lucide-react";
import api from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { roleColor } from "../theme";
import { StatValue } from "@/components/ui/UnknownValue";

export default function VerificationsPage() {
  const [verifications, setVerifications] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchVerifications();
  }, []);

  const fetchVerifications = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/verifications");
      setVerifications(response.data.data?.verifications || []);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to fetch verifications.");
      setVerifications([]);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/admin/verifications/${id}`, { status });
      await fetchVerifications();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to update verification.");
    }
  };

  const filtered = useMemo(
    () =>
      verifications.filter((v) => {
        const term = search.toLowerCase();
        const title = v.rental?.item?.title ?? "";
        const matchesSearch = !term || title.toLowerCase().includes(term);
        const matchesDecision = !decision || v.decision === decision;
        return matchesSearch && matchesDecision;
      }),
    [verifications, search, decision],
  );

  const stats = useMemo(() => {
    const scores = verifications
      .map((v) => Number(v.confidenceScore ?? 0))
      .filter((n) => !Number.isNaN(n));
    const avg = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
    return {
      total: verifications.length,
      approved: verifications.filter((v) => v.decision === "APPROVED").length,
      needsReview: verifications.filter(
        (v) => v.decision === "RETRY" || v.decision === "REJECTED",
      ).length,
      avg,
    };
  }, [verifications]);

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="AI Checks"
          title="Verifications"
          description="Deposit and return image checks with the model's confidence score for each decision."
          onRefresh={fetchVerifications}
          refreshing={loading}
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {[
            { label: "Total Checks", value: stats.total, icon: ScanFace, color: roleColor.brand },
            { label: "Approved", value: stats.approved, icon: CheckCircle2, color: roleColor.success },
            { label: "Needs Review", value: stats.needsReview, icon: TimerReset, color: roleColor.warning },
            { label: "Avg Confidence", value: `${stats.avg.toFixed(1)}%`, icon: Camera, color: roleColor.accent },
          ].map((s) => (
            <Card key={s.label} withBorder radius="md" padding="lg">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                    {s.label}
                  </Text>
                  <Text size="xl" fw={800} mt={4}>
                    {/* D-38: these read 0 (or P0) directly under the page's
                        own error banner. A count derived from a response we
                        never received is not zero, it is unknown. */}
                    <StatValue
                      value={error ? null : s.value}
                      label={`${s.label} unavailable`}
                    />
                  </Text>
                </div>
                <ThemeIcon size={40} radius="md" variant="light" color={s.color}>
                  <s.icon size={20} />
                </ThemeIcon>
              </Group>
            </Card>
          ))}
        </SimpleGrid>

        <DataTableCard
          columns={["Item", "Decision", "Confidence", "Checked", "Actions"]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search by item…",
          }}
          filters={[
            {
              value: decision,
              onChange: setDecision,
              placeholder: "Decision",
              data: [
                { value: "APPROVED", label: "Approved" },
                { value: "PENDING", label: "Pending" },
                { value: "RETRY", label: "Retry" },
                { value: "REJECTED", label: "Rejected" },
              ],
            },
          ]}
          emptyState={
            <EmptyState
              icon={ScanFace}
              title={
                error
                  ? "Could not load verification checks"
                  : verifications.length === 0
                    ? "No verifications yet"
                    : "No matching checks"
              }
              description={
                /* D-38: on THIS page the false claim is the most costly one in
                   the console. "No verifications yet" reads as "the AI pipeline
                   has produced nothing", which is a hardware/ML story. It is
                   not -- it is a failed HTTP request. */
                error
                  ? "The request failed, so this is not a count of zero."
                  : verifications.length === 0
                    ? "AI checks appear here as items are deposited and returned at the kiosk."
                    : "Try clearing the search or filters."
              }
            />
          }
        >
          {filtered.map((v) => {
            const score = Number(v.confidenceScore ?? 0);
            const rentalId = v.rentalId ?? v.rental?.id;
            return (
              <Table.Tr key={v.id}>
                <Table.Td>
                  {rentalId ? (
                    <Anchor component={Link} href={`/rentals/${rentalId}`} fw={600} size="sm">
                      {v.rental?.item?.title ?? "View rental"}
                    </Anchor>
                  ) : (
                    <Text size="sm" fw={600}>
                      {v.rental?.item?.title ?? "—"}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={v.decision} />
                </Table.Td>
                <Table.Td>
                  <Stack gap={2} w={120}>
                    <Text size="xs" fw={600}>
                      {score.toFixed(1)}%
                    </Text>
                    <Progress
                      value={score}
                      size="xs"
                      color={
                        score >= 85
                          ? roleColor.success
                          : score >= 60
                            ? roleColor.warning
                            : roleColor.critical
                      }
                    />
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{new Date(v.createdAt).toLocaleString()}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Tooltip label="Approve">
                      <ActionIcon
                        variant="light"
                        color={roleColor.success}
                        onClick={() => updateStatus(v.id, "APPROVED")}
                        aria-label="Approve verification"
                      >
                        <ThumbsUp size={15} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Reject">
                      <ActionIcon
                        variant="light"
                        color={roleColor.critical}
                        onClick={() => updateStatus(v.id, "REJECTED")}
                        aria-label="Reject verification"
                      >
                        <ThumbsDown size={15} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </DataTableCard>
      </Stack>
    </AdminLayout>
  );
}
