"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Badge,
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
  AlertTriangle,
  Camera,
  Clock,
  ShieldAlert,
  Siren,
} from "lucide-react";
import api from "@/lib/api";
import { useAdminRefetch } from "@/lib/useAdminSocket";
import type { Rental } from "@/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { roleColor } from "../theme";
import { StatValue } from "@/components/ui/UnknownValue";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

type QueueRow = {
  id: string;
  kind: "DISPUTED_RENTAL" | "FAILED_VERIFICATION";
  rentalId: string;
  title: string;
  who: string;
  detail: string;
  confidence?: number;
  createdAt: string;
  priority: number;
  amount?: number;
};

// Priority ordering is the whole point of a dedicated queue: outright
// rejections and disputes outrank low-confidence retries, and older items
// outrank newer ones within the same tier.
const PRIORITY = {
  DISPUTED: 0,
  REJECTED: 1,
  RETRY: 2,
} as const;

export default function DisputesPage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchQueue();
  }, []);

  // E2.2 / D-4 — this queue used to update only on a manual reload. The
  // refetch is quiet (no loading flash): a socket event should make the list
  // correct, not make the page look like it is starting over while an admin
  // is reading it.
  useAdminRefetch(["admin:dispute_opened"], () => void fetchQueue(true));

  const fetchQueue = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [rentalsRes, verifsRes] = await Promise.all([
        api.get("/admin/rentals"),
        api.get("/admin/verifications"),
      ]);

      const rentals: Rental[] = rentalsRes.data.data?.rentals || [];
      const verifs: any[] = verifsRes.data.data?.verifications || [];

      const disputed: QueueRow[] = rentals
        .filter((r) => r.status === "DISPUTED")
        .map((r) => ({
          id: `rental-${r.id}`,
          kind: "DISPUTED_RENTAL" as const,
          rentalId: r.id,
          title: r.item?.title ?? "—",
          who: r.renter ? `${r.renter.firstName} ${r.renter.lastName}` : "—",
          detail: "Rental flagged as disputed",
          createdAt: r.createdAt,
          priority: PRIORITY.DISPUTED,
          amount: Number(r.totalPrice || 0),
        }));

      const failed: QueueRow[] = verifs
        .filter((v) => v.decision === "REJECTED" || v.decision === "RETRY")
        .map((v) => ({
          id: `verif-${v.id}`,
          kind: "FAILED_VERIFICATION" as const,
          rentalId: v.rentalId ?? v.rental?.id ?? "",
          title: v.rental?.item?.title ?? "Verification check",
          who: v.rental?.renter
            ? `${v.rental.renter.firstName} ${v.rental.renter.lastName}`
            : "—",
          detail:
            v.decision === "REJECTED"
              ? "AI verification rejected the returned item"
              : "AI verification needs a retry — low confidence",
          confidence: Number(v.confidenceScore ?? 0),
          createdAt: v.createdAt,
          priority: v.decision === "REJECTED" ? PRIORITY.REJECTED : PRIORITY.RETRY,
        }));

      setRows(
        [...disputed, ...failed].sort(
          (a, b) =>
            a.priority - b.priority ||
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      );
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to load the dispute queue.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const term = search.toLowerCase();
        const matchesSearch =
          !term ||
          r.title.toLowerCase().includes(term) ||
          r.who.toLowerCase().includes(term);
        const matchesKind = !kind || r.kind === kind;
        return matchesSearch && matchesKind;
      }),
    [rows, search, kind],
  );

  const stats = useMemo(() => {
    const oldest = rows.length
      ? Math.floor(
          (Date.now() - new Date(rows[0].createdAt).getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;
    return {
      total: rows.length,
      disputes: rows.filter((r) => r.kind === "DISPUTED_RENTAL").length,
      failures: rows.filter((r) => r.kind === "FAILED_VERIFICATION").length,
      oldest,
    };
  }, [rows]);

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Escalations"
          title="Dispute Resolution Queue"
          description="AI-verification failures and disputed rentals, prioritised oldest-and-most-severe first."
          onRefresh={fetchQueue}
          refreshing={loading}
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {[
            { label: "Open Cases", value: stats.total, icon: Siren, color: roleColor.critical },
            { label: "Disputed Rentals", value: stats.disputes, icon: AlertTriangle, color: roleColor.cta },
            { label: "Verification Failures", value: stats.failures, icon: Camera, color: roleColor.warning },
            { label: "Oldest (days)", value: stats.oldest, icon: Clock, color: roleColor.accent },
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
          columns={["Priority", "Case", "Involved", "Confidence", "Age", "Rental"]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search item or person…",
          }}
          filters={[
            {
              value: kind,
              onChange: setKind,
              placeholder: "Case type",
              data: [
                { value: "DISPUTED_RENTAL", label: "Disputed rental" },
                { value: "FAILED_VERIFICATION", label: "Verification failure" },
              ],
            },
          ]}
          emptyState={
            <EmptyState
              icon={ShieldAlert}
              title={rows.length === 0 ? "Queue is clear" : "No matching cases"}
              description={
                rows.length === 0
                  ? "Disputed rentals and failed AI verifications land here for review."
                  : "Try clearing the search or filters."
              }
            />
          }
        >
          {filtered.map((r, i) => {
            const ageDays = Math.floor(
              (Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24),
            );
            return (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <Tooltip
                    label={
                      r.priority === PRIORITY.DISPUTED
                        ? "Disputed rental — highest priority"
                        : r.priority === PRIORITY.REJECTED
                          ? "Verification rejected"
                          : "Low-confidence retry"
                    }
                  >
                    <Badge
                      variant="filled"
                      color={
                        r.priority === PRIORITY.DISPUTED
                          ? roleColor.critical
                          : r.priority === PRIORITY.REJECTED
                            ? roleColor.cta
                            : roleColor.warning
                      }
                    >
                      #{i + 1}
                    </Badge>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Text fw={600} size="sm">
                    {r.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.detail}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.who}</Text>
                  {r.amount !== undefined && (
                    <Text size="xs" c="dimmed">
                      {peso.format(r.amount)}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {r.confidence !== undefined ? (
                    <Stack gap={2} w={110}>
                      <Text size="xs" fw={600}>
                        {r.confidence.toFixed(1)}%
                      </Text>
                      <Progress
                        value={r.confidence}
                        size="xs"
                        color={
                          r.confidence >= 85
                            ? roleColor.success
                            : r.confidence >= 60
                              ? roleColor.warning
                              : roleColor.critical
                        }
                      />
                    </Stack>
                  ) : (
                    <Text size="xs" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{ageDays}d</Text>
                </Table.Td>
                <Table.Td>
                  {r.rentalId ? (
                    <Anchor component={Link} href={`/rentals/${r.rentalId}`} size="sm" fw={600}>
                      Review
                    </Anchor>
                  ) : (
                    <Text size="xs" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </DataTableCard>
      </Stack>
    </AdminLayout>
  );
}
