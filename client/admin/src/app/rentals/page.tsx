"use client";

import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Select,
  SelectItem,
  Spinner,
  Button,
} from "@heroui/react";
import api from "@/lib/api";
import type { Rental } from "@/types";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";

const statuses = [
  "PENDING",
  "AWAITING_DEPOSIT",
  "DEPOSITED",
  "ACTIVE",
  "AWAITING_RETURN",
  "VERIFICATION",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
];

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export default function RentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
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

  const getStatusColor = (status: string) => {
    const colors: Record<string, any> = {
      ACTIVE: "success",
      PENDING: "warning",
      COMPLETED: "primary",
      CANCELLED: "danger",
      VERIFICATION: "secondary",
      AWAITING_RETURN: "warning",
    };
    return colors[status] || "default";
  };

  const filteredRentals = useMemo(
    () =>
      rentals.filter(
        (rental) => statusFilter === "" || rental.status === statusFilter,
      ),
    [rentals, statusFilter],
  );

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] app-muted">
              Operations
            </p>
            <h1 className="text-2xl font-extrabold text-[var(--color-ink)] sm:text-3xl">
              Rental Management
            </h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              aria-label="Filter by status"
              placeholder="Filter by status"
              selectedKeys={statusFilter ? [statusFilter] : []}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full sm:w-64"
              variant="bordered"
            >
              {statuses.map((status) => (
                <SelectItem key={status}>
                  {status.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </Select>
            <Button
              variant="flat"
              startContent={<RefreshCw size={16} />}
              onPress={fetchRentals}
            >
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        <div className="app-surface overflow-x-auto rounded-2xl border border-[var(--color-border)] p-3 sm:p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner label="Loading rentals..." />
            </div>
          ) : (
            <Table aria-label="Rentals table" removeWrapper>
              <TableHeader>
                <TableColumn>RENTAL ID</TableColumn>
                <TableColumn>ITEM</TableColumn>
                <TableColumn>RENTER</TableColumn>
                <TableColumn>START DATE</TableColumn>
                <TableColumn>END DATE</TableColumn>
                <TableColumn>STATUS</TableColumn>
                <TableColumn>TOTAL</TableColumn>
              </TableHeader>
              <TableBody emptyContent="No rentals found.">
                {filteredRentals.map((rental) => (
                  <TableRow key={rental.id}>
                    <TableCell className="font-mono text-xs">
                      {rental.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>{rental.item?.title || "Unknown"}</TableCell>
                    <TableCell>
                      {rental.renter?.firstName || "N/A"}{" "}
                      {rental.renter?.lastName || ""}
                    </TableCell>
                    <TableCell>
                      {format(new Date(rental.startDate), "MMM dd, yyyy")}
                    </TableCell>
                    <TableCell>
                      {format(new Date(rental.endDate), "MMM dd, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Chip color={getStatusColor(rental.status)} size="sm">
                        {rental.status.replace(/_/g, " ")}
                      </Chip>
                    </TableCell>
                    <TableCell>{peso.format(rental.totalPrice || 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
