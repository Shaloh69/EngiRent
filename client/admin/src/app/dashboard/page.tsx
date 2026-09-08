"use client";

import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Group,
  Text,
  Title,
  Card,
  SimpleGrid,
  Table,
  Badge,
  Button,
  Loader,
  Alert,
  ThemeIcon,
  Stack,
  Center,
} from "@mantine/core";
import { BarChart } from "@mantine/charts";
import { motion } from "framer-motion";
import {
  Users,
  Package,
  Receipt,
  CheckCircle2,
  DollarSign,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import api from "@/lib/api";
import type { DashboardStats, Rental } from "@/types";
import { roleColor, statusColorKey } from "../theme";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const CATEGORY_LABELS: Record<string, string> = {
  SCHOOL_ATTIRE: "School Attire",
  ACADEMIC_TOOLS: "Academic Tools",
  ELECTRONICS: "Electronics",
  DEVELOPMENT_KITS: "Dev Kits",
  MEASUREMENT_TOOLS: "Measurement",
  AUDIO_VISUAL: "Audio/Visual",
  SPORTS_EQUIPMENT: "Sports",
  OTHER: "Other",
};

// E3.1: this was a second, hand-written copy of the status→colour table that
// disagreed with StatusBadge's (PENDING yellow here, and COMPLETED brand-blue)
// — the exact duplication ENGIRENT-CLAUDE.md §7 says to grep for. Both now
// resolve through the generated map, so a status cannot mean one thing in a
// chart and another in a badge on the same page.
const statusColor = (status: string) => statusColorKey(status) ?? "gray";

// Colors are the theme's own role aliases — "blue"/"violet"/"amber" were
// left here after the palette pivot and no longer exist in theme.ts, so
// Mantine silently fell back to its library defaults (generic blue/gray),
// which is a large part of why the shipped dashboard read as unbranded.
// All three brand colors (teal, gold, coral) appear here by design, per
// mandate §1's "all three must be visibly present" rule.
const KPI_CARDS = [
  { key: "totalUsers", label: "Total Users", icon: Users, color: roleColor.brand },
  { key: "totalItems", label: "Total Items", icon: Package, color: roleColor.success },
  { key: "activeRentals", label: "Active Rentals", icon: Receipt, color: roleColor.cta },
  { key: "pendingVerifications", label: "Pending Verification", icon: CheckCircle2, color: roleColor.review },
  { key: "totalRevenue", label: "Revenue", icon: DollarSign, color: roleColor.accent },
] as const;

// Rendered by the Popular Categories chart when there are zero rentals, so
// the axes/grid still draw instead of the component disappearing entirely.
const EMPTY_CHART_SCAFFOLD = [
  { category: "Academic Tools", Rentals: 0 },
  { category: "Electronics", Rentals: 0 },
  { category: "Dev Kits", Rentals: 0 },
  { category: "Measurement", Rentals: 0 },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    totalItems: 0,
    activeRentals: 0,
    pendingVerifications: 0,
    totalRevenue: 0,
    rentalsByCategory: [],
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
        rentalsByCategory: s.rentalsByCategory ?? [],
      });

      setRecentRentals(rentals.slice(0, 8));
    } catch (apiError: any) {
      setError(
        apiError?.response?.data?.error || "Unable to load dashboard data.",
      );
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(
    () =>
      stats.rentalsByCategory.map((row) => ({
        category: CATEGORY_LABELS[row.category] ?? row.category,
        Rentals: row.count,
      })),
    [stats.rentalsByCategory],
  );

  const kpiValue = (key: (typeof KPI_CARDS)[number]["key"]) =>
    key === "totalRevenue" ? peso.format(stats.totalRevenue) : stats[key];

  return (
    <AdminLayout>
      <Stack gap="lg">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
              Overview
            </Text>
            <Title order={1} size="h2">
              Dashboard
            </Title>
          </div>
          <Button
            variant="light"
            leftSection={<RefreshCw size={16} />}
            onClick={fetchDashboardData}
            loading={loading}
          >
            Refresh Data
          </Button>
        </Group>

        {error && (
          <Alert icon={<AlertCircle size={16} />} color="danger" variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, xl: 5 }}>
          {KPI_CARDS.map((card, i) => (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.05, ease: "easeOut" }}
            >
              <Card withBorder radius="md" padding="lg">
                {/* D-47: wrap="nowrap" and the minWidth:0 below are load
                    bearing. Mantine's Group wraps by default, so on the one
                    card whose label is long enough -- "Pending Verification"
                    -- the 40px ThemeIcon was pushed onto a second line,
                    making that card taller than the other four and breaking
                    the row. Seen on the live dashboard in both themes.
                    minWidth:0 lets the label wrap INSIDE its own box instead
                    of forcing the flex row to grow. */}
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                      {card.label}
                    </Text>
                    {/* Mandate §1.2 — KPI figures and currency are set in
                        IBM Plex Mono with tabular figures, so a column of
                        numbers aligns and reads as instrument output. */}
                    <Text size="28px" fw={600} mt={4} className="mono-num">
                      {kpiValue(card.key)}
                    </Text>
                  </div>
                  <ThemeIcon size={40} radius="md" variant="light" color={card.color}>
                    <card.icon size={20} />
                  </ThemeIcon>
                </Group>
              </Card>
            </motion.div>
          ))}
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card withBorder radius="md" padding="lg">
            <Text fw={700} mb="md">
              Popular Categories
            </Text>
            {/* The chart shell always renders, including with zero rentals —
                previously this swapped the whole BarChart out for a line of
                text, so a fresh deployment showed no chart at all and the
                dashboard read as broken (mandate §0/§3: a missing component
                is a fail condition; an empty state is not). With no data,
                the axes still render and an overlay explains why it's
                empty. */}
            <div style={{ position: "relative" }}>
              <BarChart
                h={260}
                data={chartData.length > 0 ? chartData : EMPTY_CHART_SCAFFOLD}
                dataKey="category"
                series={[{ name: "Rentals", color: "teal.6" }]}
                withLegend={false}
                withYAxis
                gridAxis="xy"
              />
              {chartData.length === 0 && (
                <Center
                  style={{
                    position: "absolute",
                    inset: 0,
                    flexDirection: "column",
                    gap: 4,
                    pointerEvents: "none",
                  }}
                >
                  <Text c="dimmed" size="sm" fw={600}>
                    No rentals yet
                  </Text>
                  <Text c="dimmed" size="xs">
                    Category volume appears here once rentals start coming in.
                  </Text>
                </Center>
              )}
            </div>
          </Card>

          <Card withBorder radius="md" padding="lg">
            <Text fw={700} mb="md">
              Recent Rentals
            </Text>
            {loading ? (
              <Group justify="center" py="xl">
                <Loader />
              </Group>
            ) : (
              <Table.ScrollContainer minWidth={480}>
                <Table verticalSpacing="sm" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Item</Table.Th>
                      <Table.Th>Renter</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Total</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {recentRentals.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Text c="dimmed" ta="center" py="md">
                            No rentals found.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      recentRentals.map((rental) => (
                        <Table.Tr key={rental.id}>
                          <Table.Td>{rental.item?.title || "Unknown Item"}</Table.Td>
                          <Table.Td>
                            {rental.renter?.firstName || "N/A"} {rental.renter?.lastName || ""}
                          </Table.Td>
                          <Table.Td>
                            <Badge color={statusColor(rental.status)} variant="light">
                              {rental.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{peso.format(rental.totalPrice || 0)}</Table.Td>
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        </SimpleGrid>
      </Stack>
    </AdminLayout>
  );
}
