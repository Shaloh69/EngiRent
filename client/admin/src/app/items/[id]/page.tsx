"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Image,
  Modal,
  Progress,
  Rating,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Eye,
  EyeOff,
  Flag,
  MessageSquareOff,
  Package,
  Receipt,
  RotateCcw,
  Star,
  Trash2,
  Wallet,
} from "lucide-react";
import api from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { roleColor } from "../../theme";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const CATEGORY_LABELS: Record<string, string> = {
  SCHOOL_ATTIRE: "School Attire",
  ACADEMIC_TOOLS: "Academic Tools",
  ELECTRONICS: "Electronics",
  DEVELOPMENT_KITS: "Development Kits",
  MEASUREMENT_TOOLS: "Measurement Tools",
  AUDIO_VISUAL: "Audio/Visual",
  SPORTS_EQUIPMENT: "Sports Equipment",
  OTHER: "Other",
};

interface ItemDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  pricePerDay: number;
  pricePerWeek: number | null;
  pricePerMonth: number | null;
  securityDeposit: number;
  images: string[];
  isAvailable: boolean;
  isListed: boolean;
  isActive: boolean;
  isFlagged: boolean;
  flagReason: string | null;
  moderatedAt: string | null;
  totalRentals: number;
  averageRating: number;
  createdAt: string;
  owner: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    studentId: string;
    isVerified: boolean;
  };
}

interface RentalRow {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  actualReturnDate: string | null;
  totalPrice: number;
  renter: { id: string; firstName: string; lastName: string };
}

interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  isDeleted: boolean;
  deleteReason: string | null;
  author: { id: string; firstName: string; lastName: string };
}

/**
 * Admin item detail — checklist Stage 3.6.
 *
 * The console had an items list and nothing else, reading the public
 * /items endpoint with no admin item or review endpoints behind it at all.
 * An admin investigating a complaint about a listing could not see its
 * reviews, its rental history, or its owner's record in one place — this
 * page, and the endpoints behind it, are that missing surface.
 *
 * Ratings panel deliberately mirrors the phone app's _RatingSummary
 * (average + tappable per-star distribution) so both surfaces read the same
 * data the same way.
 */
export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const itemId = params?.id;

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [ratings, setRatings] = useState<{
    average: number;
    count: number;
    distribution: Record<string, number>;
  } | null>(null);
  const [lifetimeEarnings, setLifetimeEarnings] = useState(0);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  const [modAction, setModAction] = useState<"UNLIST" | "FLAG" | null>(null);
  const [modReason, setModReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ReviewRow | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setError("");
    setNotFound(false);
    try {
      const [detailRes, reviewsRes] = await Promise.all([
        api.get(`/admin/items/${itemId}`),
        api.get(`/admin/items/${itemId}/reviews?limit=100`),
      ]);
      setItem(detailRes.data.data.item);
      setRentals(detailRes.data.data.rentals ?? []);
      setRatings(detailRes.data.data.ratings ?? null);
      setLifetimeEarnings(detailRes.data.data.lifetimeEarnings ?? 0);
      setReviews(reviewsRes.data.data.reviews ?? []);
    } catch (apiError: any) {
      if (apiError?.response?.status === 404) {
        setNotFound(true);
      } else {
        setError(apiError?.response?.data?.error || "Failed to load this item.");
      }
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (action: "RELIST" | "UNFLAG" | "RESTORE") => {
    setSaving(true);
    try {
      await api.patch(`/admin/items/${itemId}`, { action });
      await load();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Could not update this item.");
    } finally {
      setSaving(false);
    }
  };

  const submitModAction = async () => {
    if (!modAction) return;
    setSaving(true);
    try {
      await api.patch(`/admin/items/${itemId}`, { action: modAction, reason: modReason.trim() });
      setModAction(null);
      setModReason("");
      await load();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Could not update this item.");
    } finally {
      setSaving(false);
    }
  };

  const submitDeleteReview = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await api.delete(`/admin/reviews/${deleteTarget.id}`, { data: { reason: deleteReason.trim() } });
      setDeleteTarget(null);
      setDeleteReason("");
      await load();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Could not remove this review.");
    } finally {
      setSaving(false);
    }
  };

  const maxDistribution = useMemo(() => {
    if (!ratings) return 1;
    return Math.max(1, ...Object.values(ratings.distribution));
  }, [ratings]);

  return (
    <AdminLayout>
      <Stack gap="lg">
        <Button
          component={Link}
          href="/items"
          variant="subtle"
          leftSection={<ArrowLeft size={16} />}
          w="fit-content"
          px={0}
        >
          Back to items
        </Button>

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        {notFound && (
          <Card withBorder radius="md" padding="lg">
            <EmptyState
              icon={AlertCircle}
              title="Item not found"
              description="This listing may have been permanently removed."
            />
          </Card>
        )}

        {item && (
          <>
            {/* Header — title, owner (linked), category, condition, status */}
            <Card withBorder radius="md" padding="lg">
              <Group justify="space-between" wrap="wrap" align="flex-start">
                <Stack gap={4}>
                  <Group gap="xs">
                    <Title order={2} size="h3">
                      {item.title}
                    </Title>
                    {item.isFlagged && (
                      <Badge color={roleColor.critical} leftSection={<Flag size={11} />}>
                        Flagged
                      </Badge>
                    )}
                    {!item.isActive && <Badge color="gray">Deleted by owner</Badge>}
                    {!item.isListed && <Badge color={roleColor.warning}>Unlisted</Badge>}
                  </Group>
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">
                      Listed by
                    </Text>
                    <Anchor component={Link} href={`/users/${item.owner.id}`} size="sm" fw={600}>
                      {item.owner.firstName} {item.owner.lastName}
                    </Anchor>
                    {!item.owner.isVerified && (
                      <Badge size="xs" color={roleColor.warning}>
                        Unverified owner
                      </Badge>
                    )}
                  </Group>
                  <Group gap="xs">
                    <Badge variant="light" color={roleColor.brand}>
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </Badge>
                    <Badge variant="outline">{item.condition.replace(/_/g, " ")}</Badge>
                    <StatusBadge status={item.isAvailable ? "ACTIVE" : "CANCELLED"} />
                  </Group>
                </Stack>

                {/* Moderation actions, each with a confirmation stating the
                    consequence — checklist's explicit requirement. */}
                <Group gap="xs">
                  {item.isListed ? (
                    <Button
                      variant="light"
                      color={roleColor.warning}
                      leftSection={<EyeOff size={15} />}
                      onClick={() => {
                        setModAction("UNLIST");
                        setModReason("");
                      }}
                    >
                      Unlist
                    </Button>
                  ) : (
                    <Button
                      variant="light"
                      color={roleColor.success}
                      leftSection={<Eye size={15} />}
                      loading={saving}
                      onClick={() => void moderate("RELIST")}
                    >
                      Relist
                    </Button>
                  )}
                  {item.isFlagged ? (
                    <Button
                      variant="light"
                      leftSection={<RotateCcw size={15} />}
                      loading={saving}
                      onClick={() => void moderate("UNFLAG")}
                    >
                      Unflag
                    </Button>
                  ) : (
                    <Button
                      variant="light"
                      color={roleColor.critical}
                      leftSection={<Flag size={15} />}
                      onClick={() => {
                        setModAction("FLAG");
                        setModReason("");
                      }}
                    >
                      Flag
                    </Button>
                  )}
                  {!item.isActive && (
                    <Button
                      variant="light"
                      leftSection={<RotateCcw size={15} />}
                      loading={saving}
                      onClick={() => void moderate("RESTORE")}
                    >
                      Restore
                    </Button>
                  )}
                </Group>
              </Group>

              {item.isFlagged && item.flagReason && (
                <Alert mt="md" color={roleColor.critical} icon={<Flag size={15} />}>
                  {item.flagReason}
                </Alert>
              )}

              <Divider my="md" />

              {/* Photo gallery — all images, not just the cover */}
              {item.images.length > 0 ? (
                <Group gap="sm">
                  {item.images.map((url, i) => (
                    <Image
                      key={i}
                      src={url}
                      alt={`${item.title} photo ${i + 1}`}
                      h={140}
                      w={140}
                      fit="cover"
                      radius="sm"
                      style={{ border: "1px solid var(--mantine-color-default-border)" }}
                    />
                  ))}
                </Group>
              ) : (
                <Text size="sm" c="dimmed">
                  No photos on this listing.
                </Text>
              )}

              <Text size="sm" mt="md" style={{ whiteSpace: "pre-wrap" }}>
                {item.description}
              </Text>
            </Card>

            {/* Pricing — rate, deposit, lifetime earnings */}
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              {[
                { label: "Price / day", value: peso.format(item.pricePerDay), icon: Wallet, color: roleColor.brand },
                { label: "Security deposit", value: peso.format(item.securityDeposit), icon: Wallet, color: roleColor.accent },
                { label: "Total rentals", value: item.totalRentals, icon: Receipt, color: roleColor.cta },
                { label: "Lifetime earnings", value: peso.format(lifetimeEarnings), icon: Wallet, color: roleColor.success },
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

            <Tabs defaultValue="rentals">
              <Tabs.List>
                <Tabs.Tab value="rentals" leftSection={<Package size={15} />}>
                  Rental history
                </Tabs.Tab>
                {/* Ratings and reviews get their own tab — the separate
                    reviews view the checklist explicitly asks for, not a
                    filter bolted onto another table. */}
                <Tabs.Tab value="ratings" leftSection={<Star size={15} />}>
                  Ratings &amp; reviews ({ratings?.count ?? 0})
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="rentals" pt="md">
                <DataTableCard
                  columns={["Renter", "Period", "Status", "Total"]}
                  isEmpty={rentals.length === 0}
                  emptyState={
                    <EmptyState icon={Receipt} title="No rentals yet" description="This item hasn't been rented." />
                  }
                >
                  {rentals.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>
                        <Anchor component={Link} href={`/rentals/${r.id}`} fw={600} size="sm">
                          {r.renter.firstName} {r.renter.lastName}
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
              </Tabs.Panel>

              <Tabs.Panel value="ratings" pt="md">
                <Stack gap="md">
                  {/* Average + distribution bars — mirrors the phone app's
                      _RatingSummary so both surfaces read the same. */}
                  <Card withBorder radius="md" padding="lg">
                    <Group align="flex-start" gap="xl" wrap="wrap">
                      <Stack gap={4} align="center" miw={120}>
                        <Text size="xl" fw={800}>
                          {(ratings?.average ?? 0).toFixed(1)}
                        </Text>
                        <Rating value={ratings?.average ?? 0} fractions={2} readOnly />
                        <Text size="xs" c="dimmed">
                          {ratings?.count ?? 0} review{(ratings?.count ?? 0) === 1 ? "" : "s"}
                        </Text>
                      </Stack>
                      <Stack gap={6} style={{ flex: 1, minWidth: 220 }}>
                        {[5, 4, 3, 2, 1].map((star) => {
                          const n = ratings?.distribution[String(star)] ?? 0;
                          return (
                            <Group key={star} gap="xs" wrap="nowrap">
                              <Text size="xs" w={12}>
                                {star}
                              </Text>
                              <Star size={12} fill="currentColor" style={{ flexShrink: 0 }} />
                              <Progress
                                value={(n / maxDistribution) * 100}
                                color={roleColor.brand}
                                style={{ flex: 1 }}
                                size="sm"
                              />
                              <Text size="xs" c="dimmed" w={24} ta="right">
                                {n}
                              </Text>
                            </Group>
                          );
                        })}
                      </Stack>
                    </Group>
                  </Card>

                  {reviews.length === 0 ? (
                    <Card withBorder radius="md" padding="lg">
                      <EmptyState icon={Star} title="No reviews yet" description="This item hasn't been reviewed." />
                    </Card>
                  ) : (
                    <Stack gap="sm">
                      {reviews.map((rev) => (
                        <Card
                          key={rev.id}
                          withBorder
                          radius="md"
                          padding="md"
                          opacity={rev.isDeleted ? 0.55 : 1}
                        >
                          <Group justify="space-between" align="flex-start">
                            <Stack gap={2}>
                              <Group gap="xs">
                                <Rating value={rev.rating} readOnly size="sm" />
                                <Text size="sm" fw={600}>
                                  {rev.author.firstName} {rev.author.lastName}
                                </Text>
                                {rev.isDeleted && (
                                  <Badge size="xs" color="gray">
                                    Removed
                                  </Badge>
                                )}
                              </Group>
                              {rev.comment && (
                                <Text size="sm" c={rev.isDeleted ? "dimmed" : undefined}>
                                  {rev.comment}
                                </Text>
                              )}
                              {rev.isDeleted && rev.deleteReason && (
                                <Text size="xs" c="dimmed" fs="italic">
                                  Removed: {rev.deleteReason}
                                </Text>
                              )}
                              <Text size="xs" c="dimmed">
                                {new Date(rev.createdAt).toLocaleDateString()}
                              </Text>
                            </Stack>
                            {!rev.isDeleted && (
                              <Button
                                size="xs"
                                variant="subtle"
                                color={roleColor.critical}
                                leftSection={<Trash2 size={13} />}
                                onClick={() => {
                                  setDeleteTarget(rev);
                                  setDeleteReason("");
                                }}
                              >
                                Remove
                              </Button>
                            )}
                          </Group>
                        </Card>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Tabs.Panel>
            </Tabs>
          </>
        )}
      </Stack>

      {/* Unlist/Flag confirmation — states the consequence, requires a
          reason. Reversals (Relist/Unflag/Restore) fire directly above. */}
      <Modal
        opened={!!modAction}
        onClose={() => setModAction(null)}
        title={modAction === "UNLIST" ? "Unlist this item?" : "Flag this item?"}
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {modAction === "UNLIST"
              ? "The item stops appearing in browse immediately. The owner can see it's unlisted from My Listings, but not this reason unless you tell them separately — this only records it for other admins."
              : "The item stays visible but is marked for attention across the console. Use this while investigating a complaint."}
          </Text>
          <Textarea
            label="Reason (required)"
            placeholder={modAction === "UNLIST" ? "Why this listing is being unlisted…" : "What's being investigated…"}
            value={modReason}
            onChange={(e) => setModReason(e.currentTarget.value)}
            autosize
            minRows={2}
            maxLength={1000}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setModAction(null)}>
              Cancel
            </Button>
            <Button
              color={roleColor.critical}
              leftSection={modAction === "UNLIST" ? <Ban size={15} /> : <Flag size={15} />}
              disabled={!modReason.trim()}
              loading={saving}
              onClick={() => void submitModAction()}
            >
              {modAction === "UNLIST" ? "Unlist item" : "Flag item"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Remove-review confirmation */}
      <Modal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remove this review?"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            The review is hidden from the public listing and no longer counts toward the
            average rating. It isn&apos;t permanently erased — you can see it was removed, and
            why, from this page.
          </Text>
          <Textarea
            label="Reason (required)"
            placeholder="Why this review is being removed…"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.currentTarget.value)}
            autosize
            minRows={2}
            maxLength={1000}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              color={roleColor.critical}
              leftSection={<MessageSquareOff size={15} />}
              disabled={!deleteReason.trim()}
              loading={saving}
              onClick={() => void submitDeleteReview()}
            >
              Remove review
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AdminLayout>
  );
}
