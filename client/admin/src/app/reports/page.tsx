"use client";

import { useEffect, useState, useCallback } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  Button,
  Select,
  SelectItem,
} from "@heroui/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import api from "@/lib/api";

const PERIOD_OPTIONS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
];

function periodDates(key: string): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
  from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

const PIE_COLORS = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
];

export default function ReportsPage() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = periodDates(period);
      const resp = await api.get(`/admin/reports?from=${from}&to=${to}`);
      setData(resp.data.data);
    } catch {
      setError("Failed to load report data");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExportCSV = async () => {
    const { from, to } = periodDates(period);
    const url = `/admin/reports?from=${from}&to=${to}&format=csv`;
    try {
      const resp = await api.get(url, { responseType: "blob" });
      const blob = new Blob([resp.data as BlobPart], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `engirent-report-${period}.csv`;
      a.click();
    } catch {
      alert("CSV export failed");
    }
  };

  // Build chart data from API response
  const rentalStatusData = data
    ? Object.entries(data.rentalsByStatus as Record<string, number>).map(
        ([status, count]) => ({
          status: status.replace(/_/g, " "),
          count,
        }),
      )
    : [];

  const categoryData = data
    ? Object.entries(data.categoryBreakdown as Record<string, number>).map(
        ([cat, count]) => ({
          category: cat.replace(/_/g, " "),
          count,
        }),
      )
    : [];

  const verificationData = data
    ? Object.entries(
        data.verificationsByDecision as Record<string, number>,
      ).map(([d, count]) => ({
        name: d,
        value: count,
      }))
    : [];

  const topItems: Array<{
    title: string;
    totalRentals: number;
    averageRating: number;
  }> = data?.topItems ?? [];

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] app-muted">
              Analytics
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-extrabold text-[var(--color-ink)] sm:text-3xl">
                Reports &amp; Trends
              </h1>
              <Chip
                size="sm"
                variant="flat"
                color={loading ? "default" : "success"}
              >
                {loading ? "Loading…" : "Live Data"}
              </Chip>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              selectedKeys={new Set([period])}
              onSelectionChange={(keys) => {
                const val = Array.from(keys as Set<string>)[0];
                if (val) setPeriod(val);
              }}
              className="w-40"
              aria-label="Period"
            >
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.key}>{o.label}</SelectItem>
              ))}
            </Select>
            <Button
              size="sm"
              variant="flat"
              onPress={handleExportCSV}
              isDisabled={loading || !data}
            >
              Export CSV
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-400 bg-red-50 px-4 py-3 text-red-700">
            {error} —{" "}
            <button className="underline" onClick={load}>
              retry
            </button>
          </div>
        )}

        {/* Summary cards */}
        {data && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: "Total Revenue",
                value: `PHP ${(data.summary?.totalRevenue ?? 0).toLocaleString()}`,
              },
              {
                label: "Total Rentals",
                value: data.summary?.totalRentals ?? 0,
              },
              {
                label: "Verifications",
                value: data.summary?.totalVerifications ?? 0,
              },
            ].map((s) => (
              <Card
                key={s.label}
                className="app-surface rounded-2xl border border-[var(--color-border)]"
              >
                <CardBody className="py-3 px-4">
                  <p className="text-xs app-muted font-medium">{s.label}</p>
                  <p className="text-xl font-extrabold text-[var(--color-ink)] mt-1">
                    {s.value}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Rental Status distribution */}
          <Card className="app-surface rounded-2xl border border-[var(--color-border)]">
            <CardHeader>
              <h2 className="text-lg font-bold text-[var(--color-ink)]">
                Rentals by Status
              </h2>
            </CardHeader>
            <CardBody>
              {loading ? (
                <div className="h-64 animate-pulse bg-gray-100 rounded-xl" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={rentalStatusData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      fill="#2563eb"
                      name="Count"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>

          {/* Verifications pie */}
          <Card className="app-surface rounded-2xl border border-[var(--color-border)]">
            <CardHeader>
              <h2 className="text-lg font-bold text-[var(--color-ink)]">
                Verification Decisions
              </h2>
            </CardHeader>
            <CardBody>
              {loading ? (
                <div className="h-64 animate-pulse bg-gray-100 rounded-xl" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={verificationData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label
                    >
                      {verificationData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>

          {/* Category breakdown */}
          <Card className="app-surface rounded-2xl border border-[var(--color-border)]">
            <CardHeader>
              <h2 className="text-lg font-bold text-[var(--color-ink)]">
                Items by Category
              </h2>
            </CardHeader>
            <CardBody>
              {loading ? (
                <div className="h-64 animate-pulse bg-gray-100 rounded-xl" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis
                      dataKey="category"
                      type="category"
                      width={120}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      fill="#f59e0b"
                      name="Items"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>

          {/* Top items table */}
          <Card className="app-surface rounded-2xl border border-[var(--color-border)]">
            <CardHeader>
              <h2 className="text-lg font-bold text-[var(--color-ink)]">
                Top 10 Rented Items
              </h2>
            </CardHeader>
            <CardBody>
              {loading ? (
                <div className="h-64 animate-pulse bg-gray-100 rounded-xl" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="py-2 text-left font-semibold app-muted">
                          Item
                        </th>
                        <th className="py-2 text-right font-semibold app-muted">
                          Rentals
                        </th>
                        <th className="py-2 text-right font-semibold app-muted">
                          Rating
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topItems.map((item) => (
                        <tr
                          key={item.title}
                          className="border-b border-[var(--color-border)] last:border-0"
                        >
                          <td className="py-2 font-medium text-[var(--color-ink)] truncate max-w-[160px]">
                            {item.title}
                          </td>
                          <td className="py-2 text-right">
                            {item.totalRentals}
                          </td>
                          <td className="py-2 text-right">
                            {item.averageRating.toFixed(1)} ★
                          </td>
                        </tr>
                      ))}
                      {topItems.length === 0 && (
                        <tr>
                          <td
                            colSpan={3}
                            className="py-4 text-center app-muted"
                          >
                            No items yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
