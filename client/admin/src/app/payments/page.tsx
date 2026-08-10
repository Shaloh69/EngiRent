"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  AlertCircle,
  CreditCard,
  Download,
  RotateCcw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import api from "@/lib/api";
import type { Transaction } from "@/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { roleColor } from "../theme";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const TX_TYPES = [
  "RENTAL_PAYMENT",
  "SECURITY_DEPOSIT",
  "LATE_FEE",
  "DAMAGE_FEE",
  "REFUND",
  "OWNER_PAYOUT",
];

const TX_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED"];

// Revenue counts only money the platform actually collected — deposits are
// held and returned, payouts flow outward, so neither belongs in the total.
const REVENUE_TYPES = new Set(["RENTAL_PAYMENT", "LATE_FEE", "DAMAGE_FEE"]);

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<Transaction | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [opened, { open, close }] = useDisclosure(false);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {};
      if (typeFilter) params.type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get("/admin/transactions", { params });
      setTransactions(res.data.data?.transactions ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to load transactions.");
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    void fetchTransactions();
  }, [fetchTransactions]);

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        const term = search.toLowerCase();
        if (!term) return true;
        return (
          (t.rental?.item?.title ?? "").toLowerCase().includes(term) ||
          `${t.user?.firstName ?? ""} ${t.user?.lastName ?? ""}`
            .toLowerCase()
            .includes(term) ||
          (t.paymentReferenceNo ?? "").toLowerCase().includes(term)
        );
      }),
    [transactions, search],
  );

  const stats = useMemo(() => {
    const revenue = transactions
      .filter((t) => t.status === "COMPLETED" && REVENUE_TYPES.has(t.type))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const held = transactions
      .filter((t) => t.status === "COMPLETED" && t.type === "SECURITY_DEPOSIT")
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const refunded = transactions
      .filter((t) => t.status === "REFUNDED")
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    return { revenue, held, refunded, count: transactions.length };
  }, [transactions]);

  const exportCsv = async () => {
    const resp = await api.get("/admin/transactions?format=csv", { responseType: "blob" });
    const blob = new Blob([resp.data as BlobPart], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `engirent-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const openRefund = (tx: Transaction) => {
    setSelected(tx);
    setRefundReason("");
    open();
  };

  const handleRefund = async () => {
    if (!selected) return;
    setRefunding(true);
    try {
      await api.post(`/admin/transactions/${selected.id}/refund`, {
        reason: refundReason,
      });
      close();
      await fetchTransactions();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Refund failed.");
    } finally {
      setRefunding(false);
    }
  };

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Finance"
          title="Payments &amp; Transactions"
          description="Rental payments, held deposits, fees, refunds, and owner payouts."
          onRefresh={fetchTransactions}
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
            { label: "Revenue", value: peso.format(stats.revenue), icon: TrendingUp, color: roleColor.success },
            { label: "Deposits Held", value: peso.format(stats.held), icon: Wallet, color: roleColor.accent },
            { label: "Refunded", value: peso.format(stats.refunded), icon: RotateCcw, color: roleColor.cta },
            { label: "Transactions", value: stats.count, icon: CreditCard, color: roleColor.brand },
          ].map((s) => (
            <Card key={s.label} withBorder radius="md" padding="lg">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                    {s.label}
                  </Text>
                  <Text size="xl" fw={800} mt={4}>
                    {s.value}
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
          columns={["Transaction", "User", "Type", "Amount", "Status", "Actions"]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search item, user, or reference…",
          }}
          filters={[
            {
              value: typeFilter,
              onChange: setTypeFilter,
              placeholder: "Type",
              data: TX_TYPES.map((t) => ({
                value: t,
                label: t.replace(/_/g, " ").toLowerCase(),
              })),
            },
            {
              value: statusFilter,
              onChange: setStatusFilter,
              placeholder: "Status",
              data: TX_STATUSES.map((s) => ({
                value: s,
                label: s.toLowerCase(),
              })),
            },
          ]}
          emptyState={
            <EmptyState
              icon={CreditCard}
              title={transactions.length === 0 ? "No transactions yet" : "No matching transactions"}
              description={
                transactions.length === 0
                  ? "Payments, deposits, and payouts appear here as rentals progress."
                  : "Try clearing the search or filters."
              }
            />
          }
        >
          {filtered.map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td>
                {t.rental?.id ? (
                  <Anchor component={Link} href={`/rentals/${t.rental.id}`} fw={600} size="sm">
                    {t.rental?.item?.title ?? "View rental"}
                  </Anchor>
                ) : (
                  <Text size="sm" fw={600}>
                    {t.rental?.item?.title ?? "—"}
                  </Text>
                )}
                <Text size="xs" c="dimmed" ff="monospace">
                  {t.paymentReferenceNo ?? t.id.slice(0, 8)}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {t.user ? `${t.user.firstName} ${t.user.lastName}` : "—"}
                </Text>
                <Text size="xs" c="dimmed">
                  {t.user?.email}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" tt="capitalize">
                  {t.type.replace(/_/g, " ").toLowerCase()}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={700}>
                  {peso.format(Number(t.amount || 0))}
                </Text>
              </Table.Td>
              <Table.Td>
                <StatusBadge status={t.status} />
              </Table.Td>
              <Table.Td>
                <Button
                  size="xs"
                  variant="light"
                  color={roleColor.cta}
                  leftSection={<RotateCcw size={13} />}
                  onClick={() => openRefund(t)}
                  disabled={t.status !== "COMPLETED"}
                >
                  Refund
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </DataTableCard>
      </Stack>

      <Modal opened={opened} onClose={close} title="Issue refund" centered>
        <Stack gap="md">
          {selected && (
            <Card withBorder radius="md" padding="sm" bg="var(--color-surface-soft)">
              <Text size="sm" fw={600}>
                {selected.rental?.item?.title ?? "Transaction"}
              </Text>
              <Text size="xs" c="dimmed">
                {peso.format(Number(selected.amount || 0))} ·{" "}
                {selected.type.replace(/_/g, " ").toLowerCase()}
              </Text>
            </Card>
          )}
          <Textarea
            label="Reason"
            placeholder="Why is this being refunded?"
            value={refundReason}
            onChange={(e) => setRefundReason(e.currentTarget.value)}
            minRows={3}
            autosize
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
            <Button color={roleColor.cta} onClick={handleRefund} loading={refunding}>
              Confirm refund
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AdminLayout>
  );
}
