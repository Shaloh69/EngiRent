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
import { roleColor } from "../theme";

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

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: roleColor.success,
  PENDING: roleColor.warning,
  AWAITING_DEPOSIT: roleColor.warning,
  DEPOSITED: roleColor.accent,
  COMPLETED: roleColor.brand,
  VERIFICATION: roleColor.cta,
  CANCELLED: roleColor.critical,
  DISPUTED: roleColor.critical,
};

const KPI_CARDS = [
  { key: "totalUsers", label: "Total Users", icon: Users, color: "blue" },
  { key: "totalItems", label: "Total Items", icon: Package, color: "emerald" },
  { key: "activeRentals", label: "Active Rentals", icon: Receipt, color: "violet" },
  { key: "pendingVerifications", label: "Pending Verification", icon: CheckCircle2, color: "warn" },
  { key: "totalRevenue", label: "Revenue", icon: DollarSign, color: "amber" },
] as const;

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
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                      {card.label}
                    </Text>
                    <Text size="xl" fw={800} mt={4}>
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
            {chartData.length === 0 ? (
              <Text c="dimmed" size="sm">
                No rental data yet.
              </Text>
            ) : (
              <BarChart
                h={260}
                data={chartData}
                dataKey="category"
                series={[{ name: "Rentals", color: "violet.6" }]}
                withLegend={false}
              />
            )}
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
                            <Badge color={STATUS_COLOR[rental.status] ?? "gray"} variant="light">
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
