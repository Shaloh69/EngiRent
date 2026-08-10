"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  AlertCircle,
  BadgeCheck,
  Download,
  ShieldOff,
  UserCheck,
  UserX,
  Users as UsersIcon,
} from "lucide-react";
import api from "@/lib/api";
import type { User } from "@/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { roleColor } from "../theme";

// Checklist Stage 9 — remembers this page's filters across visits.
const FILTERS_KEY = "engirent-admin-filters-users";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.search) setSearch(saved.search);
        if (saved.verifiedFilter) setVerifiedFilter(saved.verifiedFilter);
        if (saved.activeFilter) setActiveFilter(saved.activeFilter);
      }
    } catch {
      // A corrupt/old saved-filter blob should never block the page.
    }
    void fetchUsers();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({ search, verifiedFilter, activeFilter }));
    } catch {
      // Ignore — convenience, not a requirement.
    }
  }, [search, verifiedFilter, activeFilter]);

  const exportCsv = async () => {
    // Mirrors reports/page.tsx's existing handleExportCSV pattern.
    const resp = await api.get("/admin/users?format=csv&limit=5000", { responseType: "blob" });
    const blob = new Blob([resp.data as BlobPart], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `engirent-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const fetchUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/users");
      setUsers(response.data.data?.users || []);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to fetch users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      await api.patch(`/admin/users/${userId}`, { isActive: !currentStatus });
      await fetchUsers();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to update user status.");
    }
  };

  const filtered = useMemo(
    () =>
      users.filter((u) => {
        const term = search.toLowerCase();
        const matchesSearch =
          !term ||
          `${u.firstName} ${u.lastName}`.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term) ||
          (u.studentId ?? "").toLowerCase().includes(term);
        const matchesVerified =
          !verifiedFilter || String(u.isVerified) === verifiedFilter;
        const matchesActive = !activeFilter || String(u.isActive) === activeFilter;
        return matchesSearch && matchesVerified && matchesActive;
      }),
    [users, search, verifiedFilter, activeFilter],
  );

  const stats = useMemo(
    () => ({
      total: users.length,
      verified: users.filter((u) => u.isVerified).length,
      suspended: users.filter((u) => !u.isActive).length,
    }),
    [users],
  );

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Directory"
          title="User Management"
          description="Students, owners, and renters — verification status, account standing, and per-user history."
          onRefresh={fetchUsers}
          refreshing={loading}
          actions={
            <Button variant="light" leftSection={<Download size={16} />} onClick={exportCsv}>
              Export CSV
            </Button>
          }
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {[
            { label: "Total Users", value: stats.total, icon: UsersIcon, color: roleColor.brand },
            { label: "Verified", value: stats.verified, icon: BadgeCheck, color: roleColor.success },
            { label: "Suspended", value: stats.suspended, icon: ShieldOff, color: roleColor.critical },
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
          columns={["User", "Student ID", "Contact", "Verification", "Status", "Actions"]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search name, email, or student ID…",
          }}
          filters={[
            {
              value: verifiedFilter,
              onChange: setVerifiedFilter,
              placeholder: "Verification",
              data: [
                { value: "true", label: "Verified" },
                { value: "false", label: "Unverified" },
              ],
            },
            {
              value: activeFilter,
              onChange: setActiveFilter,
              placeholder: "Account status",
              data: [
                { value: "true", label: "Active" },
                { value: "false", label: "Suspended" },
              ],
            },
          ]}
          emptyState={
            <EmptyState
              icon={UsersIcon}
              title={users.length === 0 ? "No users yet" : "No matching users"}
              description={
                users.length === 0
                  ? "Registered students appear here as they sign up."
                  : "Try clearing the search or filters."
              }
            />
          }
        >
          {filtered.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>
                <Group gap="sm" wrap="nowrap">
                  <Avatar radius="xl" size={34} color={roleColor.brand}>
                    {(u.firstName?.[0] ?? "?").toUpperCase()}
                  </Avatar>
                  <div>
                    <Anchor component={Link} href={`/users/${u.id}`} fw={600} size="sm">
                      {u.firstName} {u.lastName}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {u.email}
                    </Text>
                  </div>
                </Group>
              </Table.Td>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {u.studentId || "—"}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{u.phoneNumber || "—"}</Text>
              </Table.Td>
              <Table.Td>
                <StatusBadge status={u.isVerified ? "APPROVED" : "PENDING"} />
              </Table.Td>
              <Table.Td>
                <StatusBadge status={u.isActive ? "ACTIVE" : "CANCELLED"} />
              </Table.Td>
              <Table.Td>
                <Tooltip label={u.isActive ? "Suspend account" : "Reactivate account"}>
                  <ActionIcon
                    variant="light"
                    color={u.isActive ? roleColor.critical : roleColor.success}
                    onClick={() => toggleUserStatus(u.id, u.isActive)}
                    aria-label={u.isActive ? "Suspend account" : "Reactivate account"}
                  >
                    {u.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                  </ActionIcon>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </DataTableCard>
      </Stack>
    </AdminLayout>
  );
}
