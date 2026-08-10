"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import {
  AlertCircle,
  Ban,
  Eye,
  EyeOff,
  Flag,
  Package,
  PackageCheck,
  PackageX,
  Tag,
} from "lucide-react";
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

// Checklist Stage 9 — the first table-state persistence anywhere in this
// console (everything else in localStorage so far is auth token / theme).
// Read on mount, written on change — this page "remembers where you left
// it" without being a real feature of its own.
const FILTERS_KEY = "engirent-admin-filters-items";

type BulkAction = "UNLIST" | "RELIST" | "FLAG" | "UNFLAG";
const REASON_REQUIRED: BulkAction[] = ["UNLIST", "FLAG"];

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [availability, setAvailability] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Restore saved filters once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.search) setSearch(saved.search);
        if (saved.category) setCategory(saved.category);
        if (saved.availability) setAvailability(saved.availability);
      }
    } catch {
      // A corrupt/old saved-filter blob should never block the page.
    }
    void fetchItems();
  }, []);

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({ search, category, availability }));
    } catch {
      // Ignore — this is a convenience, not a requirement.
    }
  }, [search, category, availability]);

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

  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  const toggleAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set();
      return new Set(filtered.map((i) => i.id));
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openBulk = (action: BulkAction) => {
    setBulkReason("");
    setBulkAction(action);
  };

  const runBulk = async () => {
    if (!bulkAction) return;
    if (REASON_REQUIRED.includes(bulkAction) && !bulkReason.trim()) return;
    setBulkBusy(true);
    try {
      await api.patch("/admin/items/bulk", {
        itemIds: Array.from(selected),
        action: bulkAction,
        ...(bulkReason.trim() ? { reason: bulkReason.trim() } : {}),
      });
      setBulkAction(null);
      setSelected(new Set());
      await fetchItems();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Bulk action failed.");
    } finally {
      setBulkBusy(false);
    }
  };

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

        {/* Checklist Stage 9 — bulk actions. "Moderating a spam wave" was
            previously one row at a time. */}
        {selected.size > 0 && (
          <Card withBorder radius="md" padding="sm" bg="var(--mantine-color-default-hover)">
            <Group justify="space-between" wrap="wrap">
              <Text size="sm" fw={600}>{selected.size} selected</Text>
              <Group gap="xs">
                <Button size="xs" variant="light" color={roleColor.critical} leftSection={<Ban size={14} />} onClick={() => openBulk("UNLIST")}>
                  Unlist
                </Button>
                <Button size="xs" variant="light" color={roleColor.success} leftSection={<Eye size={14} />} onClick={() => openBulk("RELIST")}>
                  Relist
                </Button>
                <Button size="xs" variant="light" color={roleColor.warning} leftSection={<Flag size={14} />} onClick={() => openBulk("FLAG")}>
                  Flag
                </Button>
                <Button size="xs" variant="subtle" leftSection={<EyeOff size={14} />} onClick={() => openBulk("UNFLAG")}>
                  Unflag
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </Group>
            </Group>
          </Card>
        )}

        <DataTableCard
          columns={["", "Item", "Owner", "Category", "Price / day", "Deposit", "Status"]}
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
          toolbar={
            filtered.length > 0 ? (
              <Checkbox
                label="Select all"
                checked={allVisibleSelected}
                onChange={toggleAll}
                size="sm"
              />
            ) : undefined
          }
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
            <Table.Tr key={i.id} bg={selected.has(i.id) ? "var(--mantine-color-default-hover)" : undefined}>
              <Table.Td>
                <Checkbox checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} />
              </Table.Td>
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

      <Modal
        opened={bulkAction !== null}
        onClose={() => setBulkAction(null)}
        title={bulkAction ? `${bulkAction.charAt(0)}${bulkAction.slice(1).toLowerCase()} ${selected.size} item(s)` : ""}
      >
        <Stack gap="md">
          {bulkAction && REASON_REQUIRED.includes(bulkAction) && (
            <Textarea
              label="Reason"
              placeholder="Why are these items being moderated?"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.currentTarget.value)}
              minRows={3}
              required
            />
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setBulkAction(null)}>Cancel</Button>
            <Button
              color={roleColor.critical}
              loading={bulkBusy}
              disabled={!!bulkAction && REASON_REQUIRED.includes(bulkAction) && !bulkReason.trim()}
              onClick={runBulk}
            >
              Confirm
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AdminLayout>
  );
}
