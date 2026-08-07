"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Avatar,
  Button,
  Card,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  ArrowLeft,
  Mail,
  Phone,
  Receipt,
  ShieldOff,
  UserCheck,
  Wallet,
} from "lucide-react";
import api from "@/lib/api";
import type { Rental, User } from "@/types";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { roleColor } from "../../theme";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params?.id;

  const [user, setUser] = useState<User | null>(null);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (userId) void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // There is no GET /admin/users/:id endpoint — the list endpoint is the
  // only source, so the single user is resolved from it client-side rather
  // than inventing an API that doesn't exist.
  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, rentalsRes] = await Promise.all([
        api.get("/admin/users"),
        api.get("/admin/rentals"),
      ]);
      const all: User[] = usersRes.data.data?.users || [];
      setUser(all.find((u) => u.id === userId) ?? null);

      const allRentals: Rental[] = rentalsRes.data.data?.rentals || [];
      setRentals(allRentals.filter((r) => r.renter?.id === userId));
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to load user.");
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async () => {
    if (!user) return;
    try {
      await api.patch(`/admin/users/${user.id}`, { isActive: !user.isActive });
      await fetchAll();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to update user.");
    }
  };

  const stats = useMemo(() => {
    const completed = rentals.filter((r) => r.status === "COMPLETED").length;
    const active = rentals.filter((r) => r.status === "ACTIVE").length;
    const spend = rentals.reduce((sum, r) => sum + Number(r.totalPrice || 0), 0);
    return { total: rentals.length, completed, active, spend };
  }, [rentals]);

  return (
    <AdminLayout>
      <Stack gap="lg">
        <Button
          component={Link}
          href="/users"
          variant="subtle"
          leftSection={<ArrowLeft size={16} />}
          w="fit-content"
          px={0}
        >
          Back to users
        </Button>

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        {!loading && !user && !error && (
          <Card withBorder radius="md" padding="lg">
            <EmptyState
              icon={AlertCircle}
              title="User not found"
              description="This account may have been removed."
            />
          </Card>
        )}

        {user && (
          <>
            <Card withBorder radius="md" padding="lg">
              <Group justify="space-between" wrap="wrap" align="flex-start">
                <Group gap="md" wrap="nowrap">
                  <Avatar radius="xl" size={64} color={roleColor.brand}>
                    {(user.firstName?.[0] ?? "?").toUpperCase()}
                  </Avatar>
                  <Stack gap={4}>
                    <Title order={2} size="h3">
                      {user.firstName} {user.lastName}
                    </Title>
                    <Group gap="xs">
                      <StatusBadge status={user.isVerified ? "APPROVED" : "PENDING"} />
                      <StatusBadge status={user.isActive ? "ACTIVE" : "CANCELLED"} />
                      <Text size="xs" c="dimmed" ff="monospace">
                        {user.studentId || "no student ID"}
                      </Text>
                    </Group>
                  </Stack>
                </Group>
                <Button
                  variant="light"
                  color={user.isActive ? roleColor.critical : roleColor.success}
                  leftSection={
                    user.isActive ? <ShieldOff size={16} /> : <UserCheck size={16} />
                  }
                  onClick={toggleStatus}
                >
                  {user.isActive ? "Suspend account" : "Reactivate account"}
                </Button>
              </Group>

              <Divider my="md" />

              <Group gap="xl" wrap="wrap">
                <Group gap={6}>
                  <Mail size={15} />
                  <Text size="sm">{user.email}</Text>
                </Group>
                <Group gap={6}>
                  <Phone size={15} />
                  <Text size="sm">{user.phoneNumber || "—"}</Text>
                </Group>
                <Text size="sm" c="dimmed">
                  Joined {new Date(user.createdAt).toLocaleDateString()}
                </Text>
              </Group>
            </Card>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              {[
                { label: "Total Rentals", value: stats.total, icon: Receipt, color: roleColor.brand },
                { label: "Active", value: stats.active, icon: Receipt, color: roleColor.success },
                { label: "Completed", value: stats.completed, icon: UserCheck, color: roleColor.accent },
                { label: "Lifetime Value", value: peso.format(stats.spend), icon: Wallet, color: roleColor.cta },
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

            <Stack gap="xs">
              <Title order={3} size="h4">
                Rental History
              </Title>
              <DataTableCard
                columns={["Item", "Period", "Status", "Total"]}
                loading={loading}
                isEmpty={rentals.length === 0}
                emptyState={
                  <EmptyState
                    icon={Receipt}
                    title="No rentals yet"
                    description="This user hasn't rented anything."
                  />
                }
              >
                {rentals.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Anchor component={Link} href={`/rentals/${r.id}`} fw={600} size="sm">
                        {r.item?.title ?? "—"}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {new Date(r.startDate).toLocaleDateString()} →{" "}
                        {new Date(r.endDate).toLocaleDateString()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={r.status} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {peso.format(Number(r.totalPrice || 0))}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </DataTableCard>
            </Stack>
          </>
        )}
      </Stack>
    </AdminLayout>
  );
}
