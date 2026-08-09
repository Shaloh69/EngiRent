"use client";

import { useEffect, useMemo, useState } from "react";
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
  Progress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Timeline,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Camera,
  MessageSquare,
  Package,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import api from "@/lib/api";
import type { Rental, Verification } from "@/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { roleColor } from "../../theme";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

// The lifecycle the mandate names explicitly. Rendering all stages always —
// with the not-yet-reached ones dimmed — makes the rental's real position in
// the flow readable at a glance, rather than only showing what's happened.
const LIFECYCLE = [
  { key: "PENDING", label: "Requested", hint: "Renter submitted the request" },
  { key: "AWAITING_DEPOSIT", label: "Paid", hint: "Payment + security deposit cleared" },
  { key: "DEPOSITED", label: "Deposited at kiosk", hint: "Owner placed the item in a locker" },
  { key: "ACTIVE", label: "Claimed", hint: "Renter collected the item" },
  { key: "VERIFICATION", label: "Return verification", hint: "AI check on the returned item" },
  { key: "COMPLETED", label: "Completed", hint: "Deposit refunded, owner paid out" },
];

export default function RentalDetailPage() {
  const params = useParams<{ id: string }>();
  const rentalId = params?.id;

  const [rental, setRental] = useState<Rental | null>(null);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [messages, setMessages] = useState<
    { id: string; body: string; createdAt: string; sender: { id: string; firstName: string; lastName: string } }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (rentalId) void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalId]);

  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [rentalsRes, verifsRes, messagesRes] = await Promise.all([
        api.get("/admin/rentals"),
        api.get("/admin/verifications"),
        // Checklist Stage 5 — "attach the transcript to disputes". Fetched
        // for every rental, not only disputed ones: a transcript is useful
        // context whenever an admin opens a rental, and there's no reason
        // to make them switch views to see it once a dispute is filed.
        api.get(`/admin/rentals/${rentalId}/conversation`).catch(() => null),
      ]);
      const all: Rental[] = rentalsRes.data.data?.rentals || [];
      setRental(all.find((r) => r.id === rentalId) ?? null);

      const allVerifs: any[] = verifsRes.data.data?.verifications || [];
      setVerifications(allVerifs.filter((v) => v.rentalId === rentalId || v.rental?.id === rentalId));

      setMessages(messagesRes?.data?.data?.messages ?? []);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to load rental.");
    } finally {
      setLoading(false);
    }
  };

  const activeIndex = useMemo(() => {
    if (!rental) return -1;
    if (rental.status === "CANCELLED" || rental.status === "DISPUTED") return -1;
    return LIFECYCLE.findIndex((s) => s.key === rental.status);
  }, [rental]);

  return (
    <AdminLayout>
      <Stack gap="lg">
        <Button
          component={Link}
          href="/rentals"
          variant="subtle"
          leftSection={<ArrowLeft size={16} />}
          w="fit-content"
          px={0}
        >
          Back to rentals
        </Button>

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        {!loading && !rental && !error && (
          <Card withBorder radius="md" padding="lg">
            <EmptyState icon={AlertCircle} title="Rental not found" />
          </Card>
        )}

        {rental && (
          <>
            <Card withBorder radius="md" padding="lg">
              <Group justify="space-between" wrap="wrap" align="flex-start">
                <Stack gap={4}>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
                    Rental
                  </Text>
                  <Title order={2} size="h3">
                    {rental.item?.title ?? "—"}
                  </Title>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {rental.id}
                  </Text>
                </Stack>
                <StatusBadge status={rental.status} variant="filled" />
              </Group>

              <Divider my="md" />

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                {[
                  {
                    label: "Renter",
                    value: rental.renter
                      ? `${rental.renter.firstName} ${rental.renter.lastName}`
                      : "—",
                    icon: UserIcon,
                    href: rental.renter ? `/users/${rental.renter.id}` : undefined,
                  },
                  {
                    label: "Item",
                    value: rental.item?.title ?? "—",
                    icon: Package,
                  },
                  {
                    label: "Period",
                    value: `${new Date(rental.startDate).toLocaleDateString()} → ${new Date(rental.endDate).toLocaleDateString()}`,
                    icon: CalendarDays,
                  },
                  {
                    label: "Total",
                    value: peso.format(Number(rental.totalPrice || 0)),
                    icon: Wallet,
                  },
                ].map((f) => (
                  <Group key={f.label} gap="sm" wrap="nowrap" align="flex-start">
                    <ThemeIcon size={36} radius="md" variant="light" color={roleColor.brand}>
                      <f.icon size={18} />
                    </ThemeIcon>
                    <div>
                      <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                        {f.label}
                      </Text>
                      {f.href ? (
                        <Anchor component={Link} href={f.href} size="sm" fw={600}>
                          {f.value}
                        </Anchor>
                      ) : (
                        <Text size="sm" fw={600}>
                          {f.value}
                        </Text>
                      )}
                    </div>
                  </Group>
                ))}
              </SimpleGrid>
            </Card>

            <SimpleGrid cols={{ base: 1, lg: 2 }}>
              <Card withBorder radius="md" padding="lg">
                <Text fw={700} mb="lg">
                  Lifecycle Timeline
                </Text>
                {rental.status === "CANCELLED" || rental.status === "DISPUTED" ? (
                  <Alert
                    icon={<AlertCircle size={16} />}
                    color={roleColor.critical}
                    variant="light"
                  >
                    This rental is {rental.status.toLowerCase()} — the normal lifecycle
                    was interrupted.
                  </Alert>
                ) : (
                  <Timeline active={activeIndex} bulletSize={24} lineWidth={2} color="teal">
                    {LIFECYCLE.map((stage, i) => (
                      <Timeline.Item
                        key={stage.key}
                        bullet={
                          i <= activeIndex ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <CircleDashed size={14} />
                          )
                        }
                        title={
                          <Text fw={600} size="sm" c={i <= activeIndex ? undefined : "dimmed"}>
                            {stage.label}
                          </Text>
                        }
                      >
                        <Text size="xs" c="dimmed">
                          {stage.hint}
                        </Text>
                      </Timeline.Item>
                    ))}
                  </Timeline>
                )}
              </Card>

              <Card withBorder radius="md" padding="lg">
                <Text fw={700} mb="md">
                  AI Verification
                </Text>
                {verifications.length === 0 ? (
                  <EmptyState
                    icon={Camera}
                    title="No verification yet"
                    description="Deposit and return checks appear here with their confidence scores and captured images."
                    minHeight={200}
                  />
                ) : (
                  <Stack gap="lg">
                    {verifications.map((v: any) => (
                      <div key={v.id}>
                        <Group justify="space-between" mb={6}>
                          <Group gap="xs">
                            <StatusBadge status={v.decision} />
                            <Text size="xs" c="dimmed">
                              {new Date(v.createdAt).toLocaleString()}
                            </Text>
                          </Group>
                          <Badge variant="light" color={roleColor.accent}>
                            {Number(v.confidenceScore ?? 0).toFixed(1)}% confidence
                          </Badge>
                        </Group>
                        <Progress
                          value={Number(v.confidenceScore ?? 0)}
                          color={
                            Number(v.confidenceScore ?? 0) >= 85
                              ? roleColor.success
                              : Number(v.confidenceScore ?? 0) >= 60
                                ? roleColor.warning
                                : roleColor.critical
                          }
                          size="sm"
                          mb="sm"
                        />
                        {(v.depositImageUrl || v.returnImageUrl) && (
                          <SimpleGrid cols={2} spacing="xs">
                            {[
                              { label: "Deposit", src: v.depositImageUrl },
                              { label: "Return", src: v.returnImageUrl },
                            ].map((img) => (
                              <div key={img.label}>
                                <Text size="xs" c="dimmed" mb={4}>
                                  {img.label}
                                </Text>
                                {img.src ? (
                                  <Image
                                    src={img.src}
                                    alt={`${img.label} capture`}
                                    radius="sm"
                                    h={120}
                                    fit="cover"
                                  />
                                ) : (
                                  <Card withBorder padding="xs" h={120}>
                                    <Text size="xs" c="dimmed" ta="center" mt="lg">
                                      Not captured
                                    </Text>
                                  </Card>
                                )}
                              </div>
                            ))}
                          </SimpleGrid>
                        )}
                      </div>
                    ))}
                  </Stack>
                )}
              </Card>
            </SimpleGrid>

            {/* Checklist Stage 5 — the reason messaging ranks above nicer
                chat features at all: a dispute needs the transcript, not
                just the two parties' say-so after the fact. */}
            <Card withBorder radius="md" padding="lg">
              <Group justify="space-between" mb="md">
                <Text fw={700}>Message Transcript</Text>
                {rental.status === "DISPUTED" && (
                  <Badge color={roleColor.critical} leftSection={<AlertCircle size={12} />}>
                    Disputed rental
                  </Badge>
                )}
              </Group>
              {messages.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No messages"
                  description="The renter and owner haven't messaged each other about this rental."
                  minHeight={140}
                />
              ) : (
                <Stack gap="sm" mah={420} style={{ overflowY: "auto" }}>
                  {messages.map((m) => (
                    <Group key={m.id} align="flex-start" gap="sm" wrap="nowrap">
                      <ThemeIcon size={28} radius="xl" variant="light" color={roleColor.brand}>
                        <Text size="xs" fw={700}>
                          {m.sender.firstName?.[0]?.toUpperCase() ?? "?"}
                        </Text>
                      </ThemeIcon>
                      <div style={{ flex: 1 }}>
                        <Group gap={6}>
                          <Text size="sm" fw={600}>
                            {m.sender.firstName} {m.sender.lastName}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {new Date(m.createdAt).toLocaleString()}
                          </Text>
                        </Group>
                        <Text size="sm">{m.body}</Text>
                      </div>
                    </Group>
                  ))}
                </Stack>
              )}
            </Card>
          </>
        )}
      </Stack>
    </AdminLayout>
  );
}
