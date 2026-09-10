"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { AlertCircle, AlertTriangle, CircleDot, Download, Receipt, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
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

const RENTAL_STATUSES = [
  "PENDING",
  "AWAITING_DEPOSIT",
  "DEPOSITED",
  "ACTIVE",
  "VERIFICATION",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
];

export default function RentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchRentals();
  }, []);

  const fetchRentals = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/rentals");
      setRentals(response.data.data?.rentals || []);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to fetch rentals.");
      setRentals([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(
    () =>
      rentals.filter((r) => {
        const term = search.toLowerCase();
        const matchesSearch =
          !term ||
          (r.item?.title ?? "").toLowerCase().includes(term) ||
          `${r.renter?.firstName ?? ""} ${r.renter?.lastName ?? ""}`
            .toLowerCase()
            .includes(term);
        const matchesStatus = !status || r.status === status;
        return matchesSearch && matchesStatus;
      }),
    [rentals, search, status],
  );

  const stats = useMemo(
    () => ({
      total: rentals.length,
      active: rentals.filter((r) => r.status === "ACTIVE").length,
      completed: rentals.filter((r) => r.status === "COMPLETED").length,
      disputed: rentals.filter((r) => r.status === "DISPUTED").length,
    }),
    [rentals],
  );

  const exportCsv = async () => {
    const resp = await api.get("/admin/rentals?format=csv", { responseType: "blob" });
    const blob = new Blob([resp.data as BlobPart], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `engirent-rentals-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Transactions"
          title="Rental Management"
          description="Every rental across the platform, with drill-down into the full lifecycle timeline."
          onRefresh={fetchRentals}
          refreshing={loading}
          actions={
            <Button variant="light" leftSection={<Download size={16} />} onClick={exportCsv}>
              Export CSV
            </Button>
          }
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {[
            { label: "Total Rentals", value: stats.total, icon: Receipt, color: roleColor.brand },
            { label: "Active Now", value: stats.active, icon: CircleDot, color: roleColor.success },
            { label: "Completed", value: stats.completed, icon: CheckCircle2, color: roleColor.accent },
            { label: "Disputed", value: stats.disputed, icon: AlertTriangle, color: roleColor.critical },
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
          columns={["Item", "Renter", "Period", "Status", "Total"]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search item or renter…",
          }}
          filters={[
            {
              value: status,
              onChange: setStatus,
              placeholder: "Status",
              data: RENTAL_STATUSES.map((s) => ({
                value: s,
                label: s.replace(/_/g, " ").toLowerCase(),
              })),
            },
          ]}
          emptyState={
            <EmptyState
              icon={Receipt}
              title={
                error
                  ? "Could not load rentals"
                  : rentals.length === 0
                    ? "No rentals yet"
                    : "No matching rentals"
              }
              description={
                /* D-38: "No rentals yet" is a claim about the data. When the
                   request FAILED we have no data to make a claim about --
                   saying there are none is simply false. Third branch added,
                   matching components/ui/UnknownValue.tsx's rule that
                   unknown is not zero. */
                error
                  ? "The request failed, so this is not a count of zero."
                  : rentals.length === 0
                  ? "Rentals appear here once students start booking items."
                  : "Try clearing the search or filters."
              }
            />
          }
        >
          {filtered.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                <Anchor component={Link} href={`/rentals/${r.id}`} fw={600} size="sm">
                  {r.item?.title ?? "—"}
                </Anchor>
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {r.renter ? `${r.renter.firstName} ${r.renter.lastName}` : "—"}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {new Date(r.startDate).toLocaleDateString()} →{" "}
                  {new Date(r.endDate).toLocaleDateString()}
                </Text>
              </Table.Td>
              <Table.Td>
                <StatusBadge status={r.status} />
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={600}>
                  {peso.format(Number(r.totalPrice || 0))}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </DataTableCard>
      </Stack>
    </AdminLayout>
  );
}
