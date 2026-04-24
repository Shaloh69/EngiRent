"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
  useDisclosure,
} from "@heroui/react";
import { RefreshCw, RotateCcw } from "lucide-react";
import api, { isDemoMode } from "@/lib/api";
import type { Transaction } from "@/types";

const TYPES = [
  "RENTAL_PAYMENT",
  "SECURITY_DEPOSIT",
  "DEPOSIT_REFUND",
  "LATE_FEE",
  "DAMAGE_FEE",
];

const STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED"];

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

function typeColor(
  type: string,
): "default" | "primary" | "success" | "warning" | "danger" | "secondary" {
  if (type === "RENTAL_PAYMENT" || type === "SECURITY_DEPOSIT")
    return "primary";
  if (type === "DEPOSIT_REFUND") return "success";
  if (type === "LATE_FEE" || type === "DAMAGE_FEE") return "danger";
  return "default";
}

function statusColor(
  s: string,
): "default" | "primary" | "success" | "warning" | "danger" | "secondary" {
  if (s === "COMPLETED") return "success";
  if (s === "PENDING" || s === "PROCESSING") return "warning";
  if (s === "FAILED") return "danger";
  if (s === "REFUNDED") return "secondary";
  return "default";
}

function fmt(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (isDemoMode) {
        setTransactions([
          {
            id: "tx-001",
            type: "RENTAL_PAYMENT",
            amount: 190,
            status: "COMPLETED",
            paymentMethod: "GCash",
            paymentReferenceNo: "PM-REF-001",
            paidAt: new Date(Date.now() - 86400000).toISOString(),
            createdAt: new Date(Date.now() - 86400000).toISOString(),
            rental: {
              id: "rental-001",
              item: { id: "item-002", title: "Arduino Starter Kit" },
            },
            user: {
              id: "user-001",
              firstName: "Ian",
              lastName: "Luna",
              email: "ian.luna@uclm.edu.ph",
            },
          },
          {
            id: "tx-002",
            type: "SECURITY_DEPOSIT",
            amount: 700,
            status: "COMPLETED",
            paymentMethod: "GCash",
            paymentReferenceNo: "PM-REF-002",
            paidAt: new Date(Date.now() - 86400000).toISOString(),
            createdAt: new Date(Date.now() - 86400000).toISOString(),
            rental: {
              id: "rental-001",
              item: { id: "item-002", title: "Arduino Starter Kit" },
            },
            user: {
              id: "user-001",
              firstName: "Ian",
              lastName: "Luna",
              email: "ian.luna@uclm.edu.ph",
            },
          },
          {
            id: "tx-003",
            type: "LATE_FEE",
            amount: 50,
            status: "COMPLETED",
            paymentMethod: "Admin Assessment",
            paidAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            rental: {
              id: "rental-001",
              item: { id: "item-002", title: "Arduino Starter Kit" },
            },
            user: {
              id: "user-001",
              firstName: "Ian",
              lastName: "Luna",
              email: "ian.luna@uclm.edu.ph",
            },
          },
        ]);
        return;
      }
      const params: Record<string, string> = {};
      if (typeFilter) params.type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get("/admin/transactions", { params });
      setTransactions(res.data.data?.transactions ?? []);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response
        ?.data?.error;
      setError(msg ?? "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    void fetchTransactions();
  }, [fetchTransactions]);

  const filtered = useMemo(
    () =>
      transactions.filter(
        (t) =>
          (typeFilter === "" || t.type === typeFilter) &&
          (statusFilter === "" || t.status === statusFilter),
      ),
    [transactions, typeFilter, statusFilter],
  );

  const openRefund = (tx: Transaction) => {
    setSelected(tx);
    setRefundReason("");
    onOpen();
  };

  const handleRefund = async () => {
    if (!selected) return;
    setRefunding(true);
    try {
      await api.post(`/admin/transactions/${selected.id}/refund`, {
        reason: refundReason,
      });
      onClose();
      await fetchTransactions();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response
        ?.data?.error;
      setError(msg ?? "Refund failed");
    } finally {
      setRefunding(false);
    }
  };

  const totalRevenue = useMemo(
    () =>
      filtered
        .filter(
          (t) =>
            t.status === "COMPLETED" &&
            (t.type === "RENTAL_PAYMENT" ||
              t.type === "LATE_FEE" ||
              t.type === "DAMAGE_FEE"),
        )
        .reduce((s, t) => s + t.amount, 0),
    [filtered],
  );

  const totalRefunded = useMemo(
    () =>
      filtered
        .filter((t) => t.status === "REFUNDED" || t.type === "DEPOSIT_REFUND")
        .reduce((s, t) => s + t.amount, 0),
    [filtered],
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">
              Payments & Transactions
            </h1>
            <p className="text-sm text-[var(--color-muted)] mt-0.5">
              All payment records — {filtered.length} transaction
              {filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="flat"
            startContent={<RefreshCw size={14} />}
            onPress={() => void fetchTransactions()}
            isLoading={loading}
          >
            Refresh
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            {
              label: "Total Revenue",
              value: peso.format(totalRevenue),
              color: "text-green-500",
            },
            {
              label: "Total Refunded",
              value: peso.format(totalRefunded),
              color: "text-red-500",
            },
            {
              label: "Pending",
              value: filtered.filter((t) => t.status === "PENDING").length,
              color: "text-amber-500",
            },
            {
              label: "Completed",
              value: filtered.filter((t) => t.status === "COMPLETED").length,
              color: "text-blue-500",
            },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <p className="text-xs text-[var(--color-muted)] uppercase tracking-wider">
                {c.label}
              </p>
              <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select
            label="Type"
            size="sm"
            className="w-48"
            selectedKeys={typeFilter ? [typeFilter] : []}
            onSelectionChange={(k) =>
              setTypeFilter(
                k === "all" ? "" : ((Array.from(k)[0] as string) ?? ""),
              )
            }
          >
            {[
              { key: "", label: "All Types" },
              ...TYPES.map((t) => ({ key: t, label: t.replace(/_/g, " ") })),
            ].map((o) => (
              <SelectItem key={o.key}>{o.label}</SelectItem>
            ))}
          </Select>
          <Select
            label="Status"
            size="sm"
            className="w-48"
            selectedKeys={statusFilter ? [statusFilter] : []}
            onSelectionChange={(k) =>
              setStatusFilter(
                k === "all" ? "" : ((Array.from(k)[0] as string) ?? ""),
              )
            }
          >
            {[
              { key: "", label: "All Statuses" },
              ...STATUSES.map((s) => ({ key: s, label: s })),
            ].map((o) => (
              <SelectItem key={o.key}>{o.label}</SelectItem>
            ))}
          </Select>
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Table */}
        <Table
          aria-label="Transactions"
          classNames={{
            wrapper:
              "bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]",
          }}
        >
          <TableHeader>
            <TableColumn>ID</TableColumn>
            <TableColumn>USER</TableColumn>
            <TableColumn>ITEM</TableColumn>
            <TableColumn>TYPE</TableColumn>
            <TableColumn>AMOUNT</TableColumn>
            <TableColumn>STATUS</TableColumn>
            <TableColumn>METHOD</TableColumn>
            <TableColumn>PAID AT</TableColumn>
            <TableColumn>ACTIONS</TableColumn>
          </TableHeader>
          <TableBody
            isLoading={loading}
            loadingContent={<Spinner />}
            emptyContent={loading ? " " : "No transactions found"}
          >
            {filtered.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell>
                  <span className="font-mono text-xs text-[var(--color-muted)]">
                    {tx.id.slice(0, 8)}…
                  </span>
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    <p className="font-medium">
                      {tx.user.firstName} {tx.user.lastName}
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {tx.user.email}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{tx.rental.item.title}</span>
                </TableCell>
                <TableCell>
                  <Chip size="sm" color={typeColor(tx.type)} variant="flat">
                    {tx.type.replace(/_/g, " ")}
                  </Chip>
                </TableCell>
                <TableCell>
                  <span
                    className={`font-semibold ${
                      tx.type === "DEPOSIT_REFUND" ? "text-green-500" : ""
                    }`}
                  >
                    {tx.type === "DEPOSIT_REFUND" ? "+" : ""}
                    {peso.format(tx.amount)}
                  </span>
                </TableCell>
                <TableCell>
                  <Chip size="sm" color={statusColor(tx.status)} variant="dot">
                    {tx.status}
                  </Chip>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-[var(--color-muted)]">
                    {tx.paymentMethod}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-[var(--color-muted)]">
                    {fmt(tx.paidAt)}
                  </span>
                </TableCell>
                <TableCell>
                  {tx.status === "COMPLETED" &&
                  tx.type !== "DEPOSIT_REFUND" &&
                  tx.type !== "DAMAGE_FEE" ? (
                    <Button
                      size="sm"
                      variant="flat"
                      color="warning"
                      startContent={<RotateCcw size={12} />}
                      onPress={() => openRefund(tx)}
                    >
                      Refund
                    </Button>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)]">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Refund modal */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>Issue Refund</ModalHeader>
          <ModalBody>
            {selected && (
              <div className="space-y-3">
                <p className="text-sm">
                  Refund <strong>{peso.format(selected.amount)}</strong> to{" "}
                  <strong>
                    {selected.user.firstName} {selected.user.lastName}
                  </strong>{" "}
                  for <strong>{selected.rental.item.title}</strong>?
                </p>
                <Textarea
                  label="Reason (optional)"
                  placeholder="e.g. item defective, rental cancelled"
                  value={refundReason}
                  onValueChange={setRefundReason}
                  size="sm"
                  minRows={2}
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose} isDisabled={refunding}>
              Cancel
            </Button>
            <Button
              color="warning"
              onPress={() => void handleRefund()}
              isLoading={refunding}
              startContent={<RotateCcw size={14} />}
            >
              Issue Refund
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AdminLayout>
  );
}
