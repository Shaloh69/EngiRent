"use client";

import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import StatsCard from "@/components/charts/StatsCard";
import {
  Users,
  Package,
  Receipt,
  CheckCircle2,
  DollarSign,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardBody,
  CardHeader,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Spinner,
} from "@heroui/react";
import api from "@/lib/api";
import type { DashboardStats, Rental } from "@/types";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    totalItems: 0,
    activeRentals: 0,
    pendingVerifications: 0,
    totalRevenue: 0,
  });
  const [recentRentals, setRecentRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError("");
    try {
      const [statsRes, rentalsRes] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/rentals"),
      ]);

      const s = statsRes.data.data || {};
      const rentals: Rental[] = rentalsRes.data.data?.rentals || [];

      setStats({
        totalUsers: s.totalUsers ?? 0,
        totalItems: s.totalItems ?? 0,
        activeRentals: s.activeRentals ?? 0,
        pendingVerifications: s.pendingVerifications ?? 0,
        totalRevenue: s.totalRevenue ?? 0,
      });

      setRecentRentals(rentals.slice(0, 8));
    } catch (apiError: any) {
      setError(
        apiError?.response?.data?.error || "Unable to load dashboard data.",
      );
      setStats({
        totalUsers: 0,
        totalItems: 0,
        activeRentals: 0,
        pendingVerifications: 0,
        totalRevenue: 0,
      });
      setRecentRentals([]);
    } finally {
      setLoading(false);
    }
  };

  const revenueLabel = useMemo(
    () => peso.format(stats.totalRevenue || 0),
    [stats.totalRevenue],
  );

  const getStatusColor = (status: string) => {
    const colors: Record<
      string,
      "success" | "warning" | "danger" | "primary" | "secondary"
    > = {
      ACTIVE: "success",
      PENDING: "warning",
      COMPLETED: "primary",
      CANCELLED: "danger",
      VERIFICATION: "secondary",
    };
    return colors[status] || "default";
  };

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] app-muted">
              Overview
            </p>
            <h1 className="text-2xl font-extrabold text-[var(--color-ink)] sm:text-3xl">
              Dashboard
            </h1>
          </div>
          <Button
            variant="flat"
            startContent={<RefreshCw size={16} />}
            className="w-full sm:w-auto"
            onPress={fetchDashboardData}
          >
            Refresh Data
          </Button>
        </div>

        {error && (
          <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatsCard
            title="Total Users"
            value={stats.totalUsers}
            icon={Users}
            color="bg-blue-500"
          />
          <StatsCard
            title="Total Items"
            value={stats.totalItems}
            icon={Package}
            color="bg-emerald-500"
          />
          <StatsCard
            title="Active Rentals"
            value={stats.activeRentals}
            icon={Receipt}
            color="bg-sky-600"
          />
          <StatsCard
            title="Pending Verification"
            value={stats.pendingVerifications}
            icon={CheckCircle2}
            color="bg-amber-500"
          />
          <StatsCard
            title="Revenue"
            value={revenueLabel}
            icon={DollarSign}
            color="bg-indigo-600"
          />
        </div>

        <Card className="app-surface rounded-2xl border border-[var(--color-border)]">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--color-ink)]">
              Recent Rentals
            </h2>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner label="Loading rentals..." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table aria-label="Recent rentals table" removeWrapper>
                  <TableHeader>
                    <TableColumn>RENTAL ID</TableColumn>
                    <TableColumn>ITEM</TableColumn>
                    <TableColumn>RENTER</TableColumn>
                    <TableColumn>STATUS</TableColumn>
                    <TableColumn>TOTAL</TableColumn>
                  </TableHeader>
                  <TableBody emptyContent="No rentals found.">
                    {recentRentals.map((rental) => (
                      <TableRow key={rental.id}>
                        <TableCell className="font-mono text-xs">
                          {rental.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell>
                          {rental.item?.title || "Unknown Item"}
                        </TableCell>
                        <TableCell>
                          {rental.renter?.firstName || "N/A"}{" "}
                          {rental.renter?.lastName || ""}
                        </TableCell>
                        <TableCell>
                          <Chip color={getStatusColor(rental.status)} size="sm">
                            {rental.status}
                          </Chip>
                        </TableCell>
                        <TableCell>
                          {peso.format(rental.totalPrice || 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </AdminLayout>
  );
}
