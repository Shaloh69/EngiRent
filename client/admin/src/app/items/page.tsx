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
  Button,
  Input,
  Select,
  SelectItem,
  Spinner,
} from "@heroui/react";
import { Search, Eye, Trash2, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import type { Item } from "@/types";

const categories = [
  "SCHOOL_ATTIRE",
  "ACADEMIC_TOOLS",
  "ELECTRONICS",
  "DEVELOPMENT_KITS",
  "MEASUREMENT_TOOLS",
  "AUDIO_VISUAL",
  "SPORTS_EQUIPMENT",
  "OTHER",
];

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
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

  const deleteItem = async (itemId: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    try {
      await api.delete(`/items/${itemId}`);
      await fetchItems();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to delete item.");
    }
  };

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const keyword = search.toLowerCase();
        const textMatch =
          item.title.toLowerCase().includes(keyword) ||
          item.description.toLowerCase().includes(keyword);
        const categoryMatch =
          categoryFilter === "" || item.category === categoryFilter;
        return textMatch && categoryMatch;
      }),
    [items, search, categoryFilter],
  );

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] app-muted">
                Inventory
              </p>
              <h1 className="text-2xl font-extrabold text-[var(--color-ink)] sm:text-3xl">
                Item Management
              </h1>
            </div>
            <Button
              variant="flat"
              startContent={<RefreshCw size={16} />}
              className="w-full sm:w-auto"
              onPress={fetchItems}
            >
              Refresh
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select
              label="Category"
              selectedKeys={categoryFilter ? [categoryFilter] : []}
              onChange={(e) => setCategoryFilter(e.target.value)}
              variant="bordered"
            >
              {categories.map((cat) => (
                <SelectItem key={cat}>{cat.replace(/_/g, " ")}</SelectItem>
              ))}
            </Select>
            <Input
              label="Search"
              placeholder="Search title or description"
              startContent={<Search size={18} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              variant="bordered"
            />
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
              <Spinner label="Loading items..." />
            </div>
          ) : (
            <Table aria-label="Items table" removeWrapper>
              <TableHeader>
                <TableColumn>TITLE</TableColumn>
                <TableColumn>CATEGORY</TableColumn>
                <TableColumn>CONDITION</TableColumn>
                <TableColumn>PRICE / DAY</TableColumn>
                <TableColumn>OWNER</TableColumn>
                <TableColumn>STATUS</TableColumn>
                <TableColumn>ACTIONS</TableColumn>
              </TableHeader>
              <TableBody emptyContent="No items found.">
                {filteredItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-semibold">
                      {item.title}
                    </TableCell>
                    <TableCell>{item.category.replace(/_/g, " ")}</TableCell>
                    <TableCell>{item.condition.replace(/_/g, " ")}</TableCell>
                    <TableCell>{peso.format(item.pricePerDay)}</TableCell>
                    <TableCell>
                      {item.owner?.firstName || "N/A"}{" "}
                      {item.owner?.lastName || ""}
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={item.isAvailable ? "success" : "warning"}
                        size="sm"
                      >
                        {item.isAvailable ? "Available" : "In Use"}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          color="primary"
                          variant="flat"
                          startContent={<Eye size={15} />}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          color="danger"
                          variant="flat"
                          startContent={<Trash2 size={15} />}
                          onPress={() => deleteItem(item.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
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
