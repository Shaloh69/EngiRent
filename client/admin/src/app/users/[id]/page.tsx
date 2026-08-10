"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  ArrowLeft,
  History,
  Mail,
  Package,
  Phone,
  Receipt,
  ShieldOff,
  Star,
  UserCheck,
  Wallet,
} from "lucide-react";
import api from "@/lib/api";
import type { User } from "@/types";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { roleColor } from "../../theme";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

interface UserItem {
  id: string;
  title: string;
  isListed: boolean;
  isActive: boolean;
  isFlagged: boolean;
  averageRating: number;
  totalRentals: number;
  createdAt: string;
}

interface UserReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string };
}

interface AuditEntry {
  id: string;
  action: string;
  reason: string | null;
  actorEmail: string;
  actorRole: string;
  createdAt: string;
}

interface UserDetail extends User {
  role: string;
  verificationStatus: string;
  lastLogin: string | null;
  payoutProvider: string | null;
  payoutInstitutionName: string | null;
  payoutAccountName: string | null;
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params?.id;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [items, setItems] = useState<UserItem[]>([]);
  const [reviewsReceived, setReviewsReceived] = useState<UserReview[]>([]);
  const [rentalCounts, setRentalCounts] = useState({ asOwner: 0, asRenter: 0 });
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (userId) void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Checklist Stage 9 — a real GET /admin/users/:id endpoint, replacing the
  // previous client-side "filter the full user list" workaround.
  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/admin/users/${userId}`);
      const data = res.data.data;
      setUser(data.user);
      setItems(data.items || []);
      setReviewsReceived(data.reviewsReceived || []);
      setRentalCounts(data.rentalCounts || { asOwner: 0, asRenter: 0 });
      setAuditEntries(data.auditEntries || []);
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

  const avgReviewRating =
    reviewsReceived.length > 0
      ? reviewsReceived.reduce((s, r) => s + r.rating, 0) / reviewsReceived.length
      : 0;

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
                      <Badge variant="outline" color={user.role === "STUDENT" ? "gray" : roleColor.accent}>
                        {user.role}
                      </Badge>
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
                {user.lastLogin && (
                  <Text size="sm" c="dimmed">
                    Last active {new Date(user.lastLogin).toLocaleDateString()}
                  </Text>
                )}
              </Group>

              {user.payoutProvider && (
                <>
                  <Divider my="md" />
                  <Group gap={6}>
                    <Wallet size={15} />
                    <Text size="sm">
                      Payout: {user.payoutInstitutionName ?? user.payoutProvider}
                      {user.payoutAccountName ? ` — ${user.payoutAccountName}` : ""}
                    </Text>
                  </Group>
                </>
              )}
            </Card>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              {[
                { label: "Rentals as renter", value: rentalCounts.asRenter, icon: Receipt, color: roleColor.brand },
                { label: "Rentals as owner", value: rentalCounts.asOwner, icon: Package, color: roleColor.accent },
                { label: "Listings", value: items.length, icon: Package, color: roleColor.cta },
                {
                  label: "Avg. rating received",
                  value: avgReviewRating > 0 ? avgReviewRating.toFixed(1) : "—",
                  icon: Star,
                  color: roleColor.success,
                },
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

            <Tabs defaultValue="listings">
              <Tabs.List>
                <Tabs.Tab value="listings" leftSection={<Package size={15} />}>
                  Listings ({items.length})
                </Tabs.Tab>
                <Tabs.Tab value="reviews" leftSection={<Star size={15} />}>
                  Reviews received ({reviewsReceived.length})
                </Tabs.Tab>
                <Tabs.Tab value="activity" leftSection={<History size={15} />}>
                  Recent activity ({auditEntries.length})
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="listings" pt="md">
                <DataTableCard
                  columns={["Title", "Status", "Rating", "Rentals"]}
                  isEmpty={items.length === 0}
                  emptyState={
                    <EmptyState icon={Package} title="No listings" description="This user hasn't listed anything." />
                  }
                >
                  {items.map((it) => (
                    <Table.Tr key={it.id}>
                      <Table.Td>
                        <Anchor component={Link} href={`/items/${it.id}`} fw={600} size="sm">
                          {it.title}
                        </Anchor>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {!it.isActive && <Badge color="gray" size="sm">Deleted</Badge>}
                          {it.isFlagged && <Badge color={roleColor.critical} size="sm">Flagged</Badge>}
                          {!it.isListed && <Badge color="gray" variant="outline" size="sm">Unlisted</Badge>}
                          {it.isActive && it.isListed && !it.isFlagged && (
                            <Badge color={roleColor.success} size="sm">Listed</Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{it.averageRating > 0 ? it.averageRating.toFixed(1) : "—"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{it.totalRentals}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </DataTableCard>
              </Tabs.Panel>

              <Tabs.Panel value="reviews" pt="md">
                <DataTableCard
                  columns={["From", "Rating", "Comment", "Date"]}
                  isEmpty={reviewsReceived.length === 0}
                  emptyState={
                    <EmptyState icon={Star} title="No reviews yet" description="Nobody has reviewed this user." />
                  }
                >
                  {reviewsReceived.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>
                        <Text size="sm">{r.author.firstName} {r.author.lastName}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={600}>{r.rating} / 5</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed" lineClamp={2}>{r.comment || "—"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{new Date(r.createdAt).toLocaleDateString()}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </DataTableCard>
              </Tabs.Panel>

              <Tabs.Panel value="activity" pt="md">
                <DataTableCard
                  columns={["Action", "By", "Reason", "When"]}
                  isEmpty={auditEntries.length === 0}
                  emptyState={
                    <EmptyState icon={History} title="No recorded activity" description="No admin action has targeted this account yet." />
                  }
                >
                  {auditEntries.map((a) => (
                    <Table.Tr key={a.id}>
                      <Table.Td>
                        <Text size="sm" fw={600}>{a.action}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{a.actorEmail}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">{a.reason || "—"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{new Date(a.createdAt).toLocaleString()}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </DataTableCard>
              </Tabs.Panel>
            </Tabs>
          </>
        )}
      </Stack>
    </AdminLayout>
  );
}
