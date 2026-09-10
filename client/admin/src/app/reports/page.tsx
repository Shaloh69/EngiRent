"use client";

import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { BarChart, DonutChart } from "@mantine/charts";
import { AlertCircle, BarChart3, Download, Star, Trophy } from "lucide-react";
import api from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { roleColor } from "../theme";

const PERIOD_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

function periodDates(key: string): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
  from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Chart series colors come from the theme's own scale so reports match the
// rest of the console — the previous version hardcoded a separate hex list
// that had nothing to do with the palette.
const DONUT_COLORS = ["teal.6", "emerald.6", "gold.6", "coral.6", "danger.6", "teal.3"];

// Rendered when a chart has no data, so the component still occupies its
// slot instead of vanishing (mandate: missing component = fail).
const EMPTY_BAR = [
  { label: "—", count: 0 },
  { label: "—", count: 0 },
  { label: "—", count: 0 },
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
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to load report data.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExportCSV = async () => {
    const { from, to } = periodDates(period);
    try {
      const resp = await api.get(
        `/admin/reports?from=${from}&to=${to}&format=csv`,
        { responseType: "blob" },
      );
      const blob = new Blob([resp.data as BlobPart], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `engirent-report-${period}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError("CSV export failed.");
    }
  };

  const rentalStatusData = data?.rentalsByStatus
    ? Object.entries(data.rentalsByStatus as Record<string, number>).map(
        ([status, count]) => ({ label: status.replace(/_/g, " "), count }),
      )
    : [];

  const categoryData = data?.categoryBreakdown
    ? Object.entries(data.categoryBreakdown as Record<string, number>).map(
        ([cat, count]) => ({ label: cat.replace(/_/g, " "), count }),
      )
    : [];

  const verificationData = data?.verificationsByDecision
    ? Object.entries(data.verificationsByDecision as Record<string, number>)
        .filter(([, v]) => Number(v) > 0)
        .map(([name, value], i) => ({
          name,
          value: Number(value),
          color: DONUT_COLORS[i % DONUT_COLORS.length],
        }))
    : [];

  const topItems: Array<{ title: string; totalRentals: number; averageRating: number }> =
    data?.topItems ?? [];

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Analytics"
          title="Reports &amp; Trends"
          description="Rental volume, category mix, and verification outcomes over the selected period."
          onRefresh={load}
          refreshing={loading}
          actions={
            <Group gap="sm">
              <SegmentedControl
                value={period}
                onChange={setPeriod}
                data={PERIOD_OPTIONS}
                size="sm"
              />
              <Button
                variant="light"
                color={roleColor.accent}
                leftSection={<Download size={16} />}
                onClick={handleExportCSV}
              >
                Export CSV
              </Button>
            </Group>
          }
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        {loading ? (
          <Center mih={320}>
            <Loader />
          </Center>
        ) : (
          <>
            <SimpleGrid cols={{ base: 1, lg: 2 }}>
              <Card withBorder radius="md" padding="lg">
                <Text fw={700} mb="md">
                  Rentals by Status
                </Text>
                <div style={{ position: "relative" }}>
                  <BarChart
                    h={260}
                    data={rentalStatusData.length ? rentalStatusData : EMPTY_BAR}
                    dataKey="label"
                    series={[{ name: "count", label: "Rentals", color: "teal.6" }]}
                    withLegend={false}
                    withYAxis
                    gridAxis="xy"
                  />
                  {rentalStatusData.length === 0 && (
                    <Center style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                      <Text size="sm" c="dimmed" fw={600}>
                        {/* D-38: a period we could not query is not a
                            period with no rentals. */}
                        {error
                          ? "Could not load this period"
                          : "No rentals in this period"}
                      </Text>
                    </Center>
                  )}
                </div>
              </Card>

              <Card withBorder radius="md" padding="lg">
                <Text fw={700} mb="md">
                  Category Breakdown
                </Text>
                <div style={{ position: "relative" }}>
                  <BarChart
                    h={260}
                    data={categoryData.length ? categoryData : EMPTY_BAR}
                    dataKey="label"
                    series={[{ name: "count", label: "Rentals", color: "gold.6" }]}
                    withLegend={false}
                    withYAxis
                    gridAxis="xy"
                  />
                  {categoryData.length === 0 && (
                    <Center style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                      <Text size="sm" c="dimmed" fw={600}>
                        {error
                          ? "Could not load this period"
                          : "No category data in this period"}
                      </Text>
                    </Center>
                  )}
                </div>
              </Card>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, lg: 2 }}>
              <Card withBorder radius="md" padding="lg">
                <Text fw={700} mb="md">
                  Verification Outcomes
                </Text>
                {verificationData.length === 0 ? (
                  <EmptyState
                    icon={BarChart3}
                    title={
                      error
                        ? "Could not load this period"
                        : "No verifications in this period"
                    }
                    description={
                      /* The title said "could not load" while this line
                         still explained what an EMPTY period looks like.
                         Half-fixed reads worse than unfixed: it tells the
                         reader the pipeline is idle in the same breath as
                         admitting we do not know. */
                      error
                        ? "The request failed, so this is not a count of zero."
                        : "AI check outcomes appear here once items are deposited and returned."
                    }
                    minHeight={240}
                  />
                ) : (
                  <Center>
                    <DonutChart
                      data={verificationData}
                      size={200}
                      thickness={28}
                      withLabelsLine
                      withLabels
                      paddingAngle={2}
                    />
                  </Center>
                )}
              </Card>

              <Card withBorder radius="md" padding="lg">
                <Group justify="space-between" mb="md">
                  <Text fw={700}>Top Items</Text>
                  <Badge variant="light" color={roleColor.accent} leftSection={<Trophy size={12} />}>
                    Most rented
                  </Badge>
                </Group>
                {topItems.length === 0 ? (
                  <EmptyState
                    icon={Trophy}
                    /* D-38: a ranking we failed to fetch is not an empty
                       ranking. */
                    title={error ? "Could not load the ranking" : "No ranking yet"}
                    description={
                      error
                        ? "The request failed, so this is not an empty ranking."
                        : "The most-rented items in this period will be listed here."
                    }
                    minHeight={240}
                  />
                ) : (
                  <Table highlightOnHover verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Item</Table.Th>
                        <Table.Th>Rentals</Table.Th>
                        <Table.Th>Rating</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {topItems.map((it) => (
                        <Table.Tr key={it.title}>
                          <Table.Td>
                            <Text size="sm" fw={600}>
                              {it.title}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{it.totalRentals}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4}>
                              <Star size={13} />
                              <Text size="sm">
                                {Number(it.averageRating ?? 0).toFixed(1)}
                              </Text>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Card>
            </SimpleGrid>
          </>
        )}
      </Stack>
    </AdminLayout>
  );
}
