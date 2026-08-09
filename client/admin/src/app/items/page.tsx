"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { AlertCircle, Package, PackageCheck, PackageX, Tag } from "lucide-react";
import api from "@/lib/api";
import type { Item } from "@/types";
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

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [availability, setAvailability] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchItems();
  }, []);

  const fetchItems = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/items");
      setItems(response.data.data?.items || []);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to fetch items.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        const term = search.toLowerCase();
        const matchesSearch =
          !term ||
          i.title.toLowerCase().includes(term) ||
          `${i.owner?.firstName ?? ""} ${i.owner?.lastName ?? ""}`
            .toLowerCase()
            .includes(term);
        const matchesCategory = !category || i.category === category;
        const matchesAvailability =
          !availability || String(i.isAvailable) === availability;
        return matchesSearch && matchesCategory && matchesAvailability;
      }),
    [items, search, category, availability],
  );

  const stats = useMemo(
    () => ({
      total: items.length,
      available: items.filter((i) => i.isAvailable).length,
      unavailable: items.filter((i) => !i.isAvailable).length,
      categories: new Set(items.map((i) => i.category)).size,
    }),
    [items],
  );

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Catalog"
          title="Item Management"
          description="Listing moderation, category coverage, and availability across the marketplace."
          onRefresh={fetchItems}
          refreshing={loading}
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {[
            { label: "Total Listings", value: stats.total, icon: Package, color: roleColor.brand },
            { label: "Available", value: stats.available, icon: PackageCheck, color: roleColor.success },
            { label: "Unavailable", value: stats.unavailable, icon: PackageX, color: roleColor.warning },
            { label: "Categories Used", value: stats.categories, icon: Tag, color: roleColor.accent },
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
          columns={["Item", "Owner", "Category", "Price / day", "Deposit", "Status"]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search item or owner…",
          }}
          filters={[
            {
              value: category,
              onChange: setCategory,
              placeholder: "Category",
              data: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            },
            {
              value: availability,
              onChange: setAvailability,
              placeholder: "Availability",
              data: [
                { value: "true", label: "Available" },
                { value: "false", label: "Unavailable" },
              ],
            },
          ]}
          emptyState={
            <EmptyState
              icon={Package}
              title={items.length === 0 ? "No listings yet" : "No matching items"}
              description={
                items.length === 0
                  ? "Items students list for rent appear here."
                  : "Try clearing the search or filters."
              }
            />
          }
        >
          {filtered.map((i) => (
            <Table.Tr key={i.id}>
              <Table.Td>
                {/* Stage 3.6 — the list had nothing to click through to; an
                    admin investigating a complaint had no detail view at all. */}
                <Anchor component={Link} href={`/items/${i.id}`} fw={600} size="sm">
                  {i.title}
                </Anchor>
                <Text size="xs" c="dimmed" lineClamp={1} maw={320}>
                  {i.description}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {i.owner ? `${i.owner.firstName} ${i.owner.lastName}` : "—"}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{CATEGORY_LABELS[i.category] ?? i.category}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={600}>
                  {peso.format(Number(i.pricePerDay || 0))}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{peso.format(Number(i.securityDeposit || 0))}</Text>
              </Table.Td>
              <Table.Td>
                <StatusBadge status={i.isAvailable ? "ACTIVE" : "CANCELLED"} />
              </Table.Td>
            </Table.Tr>
          ))}
        </DataTableCard>
      </Stack>
    </AdminLayout>
  );
}
