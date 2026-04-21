"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import { Card, CardBody, CardHeader, Chip } from "@heroui/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

const monthlyData = [
  { month: "Jan", rentals: 45, revenue: 12500 },
  { month: "Feb", rentals: 52, revenue: 15800 },
  { month: "Mar", rentals: 61, revenue: 18200 },
  { month: "Apr", rentals: 48, revenue: 14300 },
  { month: "May", rentals: 70, revenue: 21600 },
  { month: "Jun", rentals: 58, revenue: 17900 },
];

const categoryData = [
  { category: "Electronics", count: 45 },
  { category: "Dev Kits", count: 32 },
  { category: "School Attire", count: 28 },
  { category: "Tools", count: 18 },
  { category: "Audio/Visual", count: 12 },
];

export default function ReportsPage() {
  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] app-muted">
            Analytics
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold text-[var(--color-ink)] sm:text-3xl">
              Reports and Trends
            </h1>
            <Chip size="sm" variant="flat" color="primary">
              Sample Data
            </Chip>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="app-surface rounded-2xl border border-[var(--color-border)] lg:col-span-2">
            <CardHeader>
              <h2 className="text-lg font-bold text-[var(--color-ink)]">
                Monthly Revenue Trend
              </h2>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#2563eb"
                    strokeWidth={3}
                    name="Revenue (PHP)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <Card className="app-surface rounded-2xl border border-[var(--color-border)]">
            <CardHeader>
              <h2 className="text-lg font-bold text-[var(--color-ink)]">
                Monthly Rentals
              </h2>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="rentals" fill="#10b981" name="Rentals" />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <Card className="app-surface rounded-2xl border border-[var(--color-border)]">
            <CardHeader>
              <h2 className="text-lg font-bold text-[var(--color-ink)]">
                Items by Category
              </h2>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="category" type="category" width={110} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" fill="#f59e0b" name="Items" />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
