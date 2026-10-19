"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import { Alert, Anchor, Badge, Card, Group, SimpleGrid, Stack, Table, Text, ThemeIcon, Tooltip } from "@mantine/core";
import { AlertCircle, Banknote, Camera, Clock, FileWarning, Gavel, Repeat, Video } from "lucide-react";
import api from "@/lib/api";
import { useAdminRefetch } from "@/lib/useAdminSocket";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatValue } from "@/components/ui/UnknownValue";
import { roleColor } from "../theme";
import {
  concernBadge,
  ConcernListRow,
  countdown,
  KIND_EXPLAINED,
  OPEN_CONCERN_STATUSES,
  pesoFmt,
  when,
} from "@/lib/concerns";

/**
 * Concerns v2 (user rulings 2026-10-13): problems the locker camera cannot see.
 * A renter reports an item broken on receipt; an owner reports damage after a
 * return; either adds information while a return is being checked. Each comes
 * with a statement, photos and (for damage) a video; the other student may
 * answer within 24 h; you decide a percentage of responsibility.
 */
export default function ConcernsPage() {
  const [rows, setRows] = useState<ConcernListRow[]>([]);
  const [filter, setFilter] = useState<string | null>("open");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  const fetchRows = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/concerns", { params: { filter: "all" } });
      setRows(res.data.data?.concerns ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load the cases.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
    const t = setInterval(() => {
      setTick((n) => n + 1);
      void fetchRows(true);
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  useAdminRefetch(["admin:concern"], () => void fetchRows(true));

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return rows.filter((r) => {
      const matchesSearch =
        !term ||
        r.referenceNo.toLowerCase().includes(term) ||
        r.itemTitle.toLowerCase().includes(term) ||
        r.reporter.toLowerCase().includes(term) ||
        r.respondent.toLowerCase().includes(term);
      const open = OPEN_CONCERN_STATUSES.includes(r.status);
      const matchesFilter =
        filter === "open" ? open : filter === "ready" ? r.status === "UNDER_REVIEW" : filter === "owed" ? (r.amountOwed ?? 0) > 0 && !r.owedPaidAt : filter === "decided" ? !open : true;
      return matchesSearch && matchesFilter;
    });
  }, [rows, search, filter]);

  const stats = useMemo(
    () => ({
      ready: rows.filter((r) => r.status === "UNDER_REVIEW").length,
      waiting: rows.filter((r) => r.status === "AWAITING_RESPONSE").length,
      owed: rows.filter((r) => (r.amountOwed ?? 0) > 0 && !r.owedPaidAt).length,
      repeat: rows.filter((r) => r.repeatFlag).length,
    }),
    [rows],
  );

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Escalations"
          title="Concerns"
          description="Problems the locker camera cannot see, reported by students with photos, a video and a written account. You decide how much each side is responsible."
          onRefresh={() => void fetchRows()}
          refreshing={loading}
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {[
            { label: "Ready for your decision", value: stats.ready, icon: Gavel, color: roleColor.warning },
            { label: "Waiting for an answer", value: stats.waiting, icon: Clock, color: roleColor.review },
            { label: "Money still owed", value: stats.owed, icon: Banknote, color: roleColor.critical },
            { label: "Repeat-case flags", value: stats.repeat, icon: Repeat, color: roleColor.cta },
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
          columns={["Case", "Reported by", "Against", "Status", "Evidence", "Money", ""]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{ value: search, onChange: setSearch, placeholder: "Search reference, item or student…" }}
          filters={[
            {
              value: filter,
              onChange: setFilter,
              placeholder: "Show",
              data: [
                { value: "open", label: "All open" },
                { value: "ready", label: "Ready for your decision" },
                { value: "owed", label: "Money still owed" },
                { value: "decided", label: "Decided / closed" },
                { value: "all", label: "Everything" },
              ],
            },
          ]}
          emptyState={
            <EmptyState
              icon={FileWarning}
              title={rows.length === 0 ? "No concerns yet" : "No matching cases"}
              description={
                rows.length === 0
                  ? "A case appears here when a student reports a problem from a rental in the app."
                  : "Try clearing the search or changing what is shown."
              }
            />
          }
        >
          {filtered.map((r) => {
            const cd = countdown(r.responseDueAt);
            return (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <Group gap={6}>
                    <Text fw={700} size="sm">
                      {r.referenceNo}
                    </Text>
                    {r.repeatFlag && (
                      <Tooltip label="2 or more upheld cases against this student in 90 days">
                        <Badge size="xs" color={roleColor.cta} variant="light">
                          Repeat
                        </Badge>
                      </Tooltip>
                    )}
                  </Group>
                  <Text size="xs" fw={600}>
                    {r.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.itemTitle} · {when(r.createdAt)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.reporter}</Text>
                  <Text size="xs" c="dimmed">
                    {r.reporterParty === "RENTER" ? "renter" : "owner"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{r.respondent}</Text>
                  <Text size="xs" c="dimmed">
                    {r.respondedAt ? `answered ${when(r.respondedAt)}` : r.status === "AWAITING_RESPONSE" ? `answer ${cd.text}` : "did not answer"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={concernBadge(r.status, r.settled).color} variant="light">
                    {concernBadge(r.status, r.settled).label}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Tooltip label={`${r.photos} photo(s)`}>
                      <Group gap={2}>
                        <Camera size={14} />
                        <Text size="xs">{r.photos}</Text>
                      </Group>
                    </Tooltip>
                    <Tooltip label={`${r.videos} video(s)`}>
                      <Group gap={2}>
                        <Video size={14} />
                        <Text size="xs">{r.videos}</Text>
                      </Group>
                    </Tooltip>
                  </Group>
                </Table.Td>
                <Table.Td>
                  {(r.amountOwed ?? 0) > 0 ? (
                    <Text size="sm" c={r.owedPaidAt ? "dimmed" : undefined} fw={r.owedPaidAt ? 400 : 700}>
                      {pesoFmt.format(r.amountOwed ?? 0)} {r.owedPaidAt ? "paid" : "owed"}
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Anchor component={Link} href={`/concerns/${r.id}`} size="sm" fw={600}>
                    Open
                  </Anchor>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </DataTableCard>

        <Text size="xs" c="dimmed">
          {KIND_EXPLAINED.DEFECT_ON_RECEIPT} {KIND_EXPLAINED.DAMAGE_ON_RETURN} {KIND_EXPLAINED.RETURN_CHECK}
        </Text>
      </Stack>
    </AdminLayout>
  );
}
