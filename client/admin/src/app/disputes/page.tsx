"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { AlertCircle, Banknote, Clock, History, MessageCircleQuestion, ShieldAlert, Siren } from "lucide-react";
import api from "@/lib/api";
import { useAdminRefetch } from "@/lib/useAdminSocket";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatValue } from "@/components/ui/UnknownValue";
import { roleColor } from "../theme";
import {
  ACTIVE_STATUSES,
  countdown,
  DISPUTE_STATUS_COLOR,
  DISPUTE_STATUS_LABEL,
  DisputeListRow,
  LegacyRow,
  pesoFmt,
  when,
} from "@/lib/disputes";

/**
 * Dispute System v2 (user rulings 2026-10-11). One row per CASE, opened only by
 * an admin's Reject on a return (ruling 2). Returns the AI flagged but no admin
 * has decided are in Condition checks, not here: a flag is not a dispute.
 */
export default function DisputesPage() {
  const [rows, setRows] = useState<DisputeListRow[]>([]);
  const [legacy, setLegacy] = useState<LegacyRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [migrating, setMigrating] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const fetchCases = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/disputes");
      setRows(res.data.data?.disputes ?? []);
      setLegacy(res.data.data?.legacy ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load the disputes.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCases();
    // Countdowns move; the data is refetched quietly every minute too.
    const t = setInterval(() => {
      setTick((n) => n + 1);
      void fetchCases(true);
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  useAdminRefetch(
    ["admin:dispute_opened", "admin:dispute_escalated", "admin:dispute_review_requested", "admin:kiosk_payment_waiting"],
    () => void fetchCases(true),
  );

  const migrate = async (rentalId: string) => {
    setMigrating(rentalId);
    try {
      const res = await api.post(`/admin/disputes/migrate/${rentalId}`);
      notifications.show({ color: "teal", message: `Migrated to ${res.data.data.dispute.referenceNo}` });
      await fetchCases(true);
    } catch (e: any) {
      notifications.show({ color: "red", message: e?.response?.data?.error || "Migration failed" });
    } finally {
      setMigrating(null);
    }
  };

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return rows.filter((r) => {
      const matchesSearch =
        !term ||
        r.referenceNo.toLowerCase().includes(term) ||
        r.itemTitle.toLowerCase().includes(term) ||
        `${r.renter.firstName} ${r.renter.lastName} ${r.renter.studentId}`.toLowerCase().includes(term);
      const matchesStatus = !status || (status === "ACTIVE" ? ACTIVE_STATUSES.includes(r.status) : r.status === status);
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, status]);

  const stats = useMemo(
    () => ({
      open: rows.filter((r) => ACTIVE_STATUSES.includes(r.status)).length,
      payment: rows.filter((r) => r.status === "PAYMENT_PENDING").length,
      escalated: rows.filter((r) => r.escalatedAt && ACTIVE_STATUSES.includes(r.status)).length,
      review: rows.filter((r) => r.reviewRequestedAt && ACTIVE_STATUSES.includes(r.status)).length,
    }),
    [rows],
  );

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Escalations"
          title="Disputes"
          description="Wrong-item cases. A case opens only when an admin rejects a return; the AI alone never starts one."
          onRefresh={() => void fetchCases()}
          refreshing={loading}
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        {legacy.length > 0 && (
          <Alert icon={<History size={16} />} color={roleColor.warning} variant="light" title="Cases opened before Dispute v2">
            <Stack gap="xs">
              <Text size="sm">
                These rentals are DISPUTED under the old rules (the owner collects the item). Migrating one makes it a v2 case:
                the renter gets the item back, the deadline and fees start now, and both people are told. Nothing physical moves.
              </Text>
              {legacy.map((l) => (
                <Group key={l.id} justify="space-between">
                  <Text size="sm">
                    <b>{l.item.title}</b> · renter {l.renter.firstName} {l.renter.lastName} · owner {l.owner.firstName}{" "}
                    {l.owner.lastName} · since {when(l.updatedAt)}
                  </Text>
                  <Group gap="xs">
                    <Anchor component={Link} href={`/rentals/${l.id}`} size="sm">
                      Rental
                    </Anchor>
                    <Button size="xs" color={roleColor.cta} loading={migrating === l.id} onClick={() => void migrate(l.id)}>
                      Migrate to v2
                    </Button>
                  </Group>
                </Group>
              ))}
            </Stack>
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {[
            { label: "Open cases", value: stats.open, icon: Siren, color: roleColor.critical },
            { label: "Payments waiting", value: stats.payment, icon: Banknote, color: roleColor.warning },
            { label: "Escalated", value: stats.escalated, icon: ShieldAlert, color: roleColor.cta },
            { label: "Review requested", value: stats.review, icon: MessageCircleQuestion, color: roleColor.review },
          ].map((s) => (
            <Card key={s.label} withBorder radius="md" padding="lg">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                    {s.label}
                  </Text>
                  <Text size="xl" fw={800} mt={4}>
                    <StatValue value={error ? null : s.value} label={`${s.label} unavailable`} />
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
          columns={["Case", "Renter", "Status", "Deadline", "Owed", "Wrong item", ""]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{ value: search, onChange: setSearch, placeholder: "Search reference, item or student…" }}
          filters={[
            {
              value: status,
              onChange: setStatus,
              placeholder: "Status",
              data: [
                { value: "ACTIVE", label: "All open" },
                ...Object.entries(DISPUTE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
              ],
            },
          ]}
          emptyState={
            <EmptyState
              icon={ShieldAlert}
              title={rows.length === 0 ? "No disputes" : "No matching cases"}
              description={
                rows.length === 0
                  ? "A case appears here when an admin rejects a returned item in Condition checks."
                  : "Try clearing the search or the status filter."
              }
            />
          }
        >
          {filtered.map((r) => {
            const cd = countdown(r.deadlineAt);
            const active = ACTIVE_STATUSES.includes(r.status);
            return (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <Text fw={700} size="sm">
                    {r.referenceNo}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.itemTitle}
                    {r.offense >= 2 ? " · REPEAT OFFENCE" : ""}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {r.renter.firstName} {r.renter.lastName}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.renter.studentId}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={4}>
                    <Badge color={DISPUTE_STATUS_COLOR[r.status] ?? "gray"} variant="light">
                      {DISPUTE_STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                    {r.escalatedAt && active && (
                      <Badge color={roleColor.cta} variant="filled" size="xs">
                        Escalated
                      </Badge>
                    )}
                    {r.reviewRequestedAt && active && (
                      <Badge color={roleColor.review} variant="outline" size="xs">
                        Review requested
                      </Badge>
                    )}
                  </Stack>
                </Table.Td>
                <Table.Td>
                  {active ? (
                    <Tooltip label={when(r.deadlineAt)}>
                      <Group gap={4} wrap="nowrap">
                        <Clock size={14} />
                        <Text size="sm" c={cd.overdue ? "red" : undefined} fw={cd.overdue ? 700 : 400}>
                          {cd.text}
                        </Text>
                      </Group>
                    </Tooltip>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {r.resolution ?? "—"}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {pesoFmt.format(r.owed)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    paid {pesoFmt.format(r.paid)}
                    {r.pending > 0 ? ` · ${pesoFmt.format(r.pending)} pending` : ""}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {r.wrongItemMoving ? "moving to the lower door" : r.wrongItemWaiting ? "waiting for the renter" : "collected / none"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Anchor component={Link} href={`/disputes/${r.id}`} size="sm" fw={600}>
                    Open case
                  </Anchor>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </DataTableCard>
      </Stack>
    </AdminLayout>
  );
}
