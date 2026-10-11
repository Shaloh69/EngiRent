"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Grid,
  Group,
  Image,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Timeline,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Bot,
  Clock,
  FileText,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  Send,
  ShieldAlert,
  User,
} from "lucide-react";
import api from "@/lib/api";
import { useAdminRefetch } from "@/lib/useAdminSocket";
import { roleColor } from "../../theme";
import {
  ACTIVE_STATUSES,
  countdown,
  DISPUTE_STATUS_COLOR,
  DISPUTE_STATUS_LABEL,
  DisputeCase,
  OFFICE_LABEL,
  pesoFmt,
  when,
} from "@/lib/disputes";

/**
 * One dispute case (Dispute System v2, user rulings 2026-10-11). Ruling 14: the
 * admin sees ALL case data and the EXACT words the renter and the owner were
 * shown, so the timeline renders each message verbatim from the case log.
 */

const EVENT_LABEL: Record<string, string> = {
  OPENED: "Case opened",
  PROMPT: "Full prompt shown to the renter",
  MESSAGE: "Message",
  REMINDER: "Reminder",
  CONTACT: "Contact attempt (logged by staff)",
  PAYMENT_SUBMITTED: "Payment submitted",
  PAYMENT_CONFIRMED: "Payment confirmed",
  PAYMENT_REJECTED: "Payment not completed",
  FEES_FROZEN: "Fees frozen",
  FEES_RESUMED: "Fees resumed",
  WRONG_ITEM_DROP_SENT: "Wrong item: drop command sent",
  WRONG_ITEM_PLACED: "Wrong item: ready at the lower door",
  WRONG_ITEM_COLLECTED: "Wrong item collected by the renter",
  CORRECT_ITEM_PLACED: "Item placed for the return",
  DEADLINE_CHANGED: "Deadline changed",
  ESCALATED: "Escalated",
  LETTER_GENERATED: "Letter generated",
  LETTER_SUBMITTED: "Letter submitted",
  REVIEW_REQUESTED: "Renter requested a review",
  KIOSK_VISIT: "Renter at the kiosk",
  KIOSK_VISIT_ENDED: "Kiosk visit ended",
  DOOR_GRANTED: "Door granted for the return",
  RESOLVED: "Resolved",
  NOTE: "Note",
};

export default function DisputeCasePage() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<DisputeCase | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [contact, setContact] = useState({ audience: "RENTER", channel: "PHONE", outcome: "NO_ANSWER", note: "" });
  const [note, setNote] = useState("");
  const [closeMode, setCloseMode] = useState<null | "OVERTURNED" | "UNRECOVERED">(null);
  const [closeNote, setCloseNote] = useState("");
  const [resendOpen, setResendOpen] = useState(false);
  const [preface, setPreface] = useState("");
  const [liftNote, setLiftNote] = useState("");
  const [liftOpen, setLiftOpen] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setError("");
      try {
        const res = await api.get(`/admin/disputes/${id}`);
        setC(res.data.data);
      } catch (e: any) {
        setError(e?.response?.data?.error || "Failed to load the case.");
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      setTick((n) => n + 1);
      void load(true);
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useAdminRefetch(["admin:kiosk_payment_waiting", "admin:dispute_escalated", "admin:dispute_review_requested"], () => void load(true));

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      notifications.show({ color: "teal", message: ok });
      await load(true);
      return true;
    } catch (e: any) {
      notifications.show({ color: "red", message: e?.response?.data?.error || e?.response?.data?.message || "Failed" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (error && !c) {
    return (
      <AdminLayout>
        <Alert icon={<AlertCircle size={16} />} color="red">
          {error}
        </Alert>
      </AdminLayout>
    );
  }
  if (!c) {
    return (
      <AdminLayout>
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      </AdminLayout>
    );
  }

  const d = c.dispute;
  const r = c.rental;
  const active = ACTIVE_STATUSES.includes(d.status);
  const cd = countdown(d.deadlineAt);
  const pendingTx = c.transactions.find((t) => t.disputeId === d.id && (t.status === "PENDING" || t.status === "PROCESSING"));
  const visitLeft = c.visit ? Math.max(0, Math.round((c.visit.expiresAt - Date.now()) / 1000)) : 0;
  const reviewEvent = [...c.events].reverse().find((e) => e.type === "REVIEW_REQUESTED");

  return (
    <AdminLayout>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Anchor component={Link} href="/disputes" size="sm">
              <Group gap={4}>
                <ArrowLeft size={14} /> Disputes
              </Group>
            </Anchor>
            <Group gap="sm">
              <Title order={2}>{d.referenceNo}</Title>
              <Badge size="lg" color={DISPUTE_STATUS_COLOR[d.status] ?? "gray"} variant="light">
                {DISPUTE_STATUS_LABEL[d.status] ?? d.status}
              </Badge>
              {d.offense >= 2 && (
                <Badge size="lg" color="red" variant="filled">
                  Repeat offence ({d.offense})
                </Badge>
              )}
              {d.escalatedAt && active && (
                <Badge size="lg" color={roleColor.cta} variant="filled">
                  Escalated {when(d.escalatedAt)}
                </Badge>
              )}
            </Group>
            <Text c="dimmed" size="sm">
              {r.item.title} · opened {when(d.openedAt)} ·{" "}
              <Anchor component={Link} href={`/rentals/${r.id}`} size="sm">
                rental
              </Anchor>
              {d.resolution ? ` · ${d.resolution.replace(/_/g, " ").toLowerCase()}${d.resolutionNote ? `: ${d.resolutionNote}` : ""}` : ""}
            </Text>
          </Stack>
          {active && (
            <Group gap="xs">
              <Button variant="light" leftSection={<Send size={14} />} onClick={() => setResendOpen(true)}>
                Re-send case details
              </Button>
              <Button variant="light" color="teal" onClick={() => setCloseMode("OVERTURNED")}>
                Overturn (it was the right item)
              </Button>
              <Button variant="light" color="red" onClick={() => setCloseMode("UNRECOVERED")}>
                Close as unrecovered
              </Button>
            </Group>
          )}
        </Group>

        {c.visit && (
          <Alert
            color={pendingTx?.paymentMethod?.startsWith("Manual") ? "red" : "orange"}
            variant="filled"
            icon={<Banknote size={18} />}
            title={`The renter is at kiosk ${c.visit.kioskId} now (${Math.floor(visitLeft / 60)}:${String(visitLeft % 60).padStart(2, "0")} left)`}
          >
            <Stack gap="xs">
              <Text size="sm">
                {c.visit.doorGranted
                  ? "Payment confirmed; the upper door is granted for the return."
                  : pendingTx
                    ? `Payment of ${pesoFmt.format(pendingTx.amount)} submitted via ${pendingTx.paymentMethod}. ${
                        pendingTx.paymentMethod.startsWith("Manual")
                          ? "PayMongo is unavailable: confirm it once the money is in, and the door opens for them."
                          : "Waiting for PayMongo (checked every few seconds)."
                      }`
                    : "They have been shown the amount owed and have not paid yet."}
              </Text>
              {pendingTx && !c.visit.doorGranted && (
                <Group>
                  <Button
                    color="white"
                    variant="white"
                    loading={busy === "confirm"}
                    onClick={() =>
                      void act(
                        "confirm",
                        () => api.post(`/admin/transactions/${pendingTx.id}/decide-payment`, { decision: "APPROVE" }),
                        "Payment confirmed",
                      )
                    }
                  >
                    Confirm payment received
                  </Button>
                  <Button
                    variant="outline"
                    color="white"
                    loading={busy === "reject"}
                    onClick={() =>
                      void act(
                        "reject",
                        () => api.post(`/admin/transactions/${pendingTx.id}/decide-payment`, { decision: "REJECT" }),
                        "Payment rejected; fees resume",
                      )
                    }
                  >
                    Not received
                  </Button>
                </Group>
              )}
            </Stack>
          </Alert>
        )}

        {!c.visit && pendingTx && (
          <Alert color="orange" icon={<Banknote size={16} />} title="A payment is waiting">
            <Group justify="space-between">
              <Text size="sm">
                {pesoFmt.format(pendingTx.amount)} via {pendingTx.paymentMethod}, submitted {when(pendingTx.createdAt)}. Fees stay frozen until it
                is decided.
              </Text>
              <Group gap="xs">
                <Button
                  size="xs"
                  loading={busy === "confirm"}
                  onClick={() =>
                    void act(
                      "confirm",
                      () => api.post(`/admin/transactions/${pendingTx.id}/decide-payment`, { decision: "APPROVE" }),
                      "Payment confirmed",
                    )
                  }
                >
                  Confirm received
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  loading={busy === "reject"}
                  onClick={() =>
                    void act(
                      "reject",
                      () => api.post(`/admin/transactions/${pendingTx.id}/decide-payment`, { decision: "REJECT" }),
                      "Payment rejected; fees resume",
                    )
                  }
                >
                  Not received
                </Button>
              </Group>
            </Group>
          </Alert>
        )}

        {reviewEvent && active && (
          <Alert color={roleColor.review} icon={<MessageSquare size={16} />} title={`The renter asked for a review (${when(reviewEvent.createdAt)})`}>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {reviewEvent.message}
            </Text>
            <Text size="xs" c="dimmed" mt="xs">
              If the photos show it was the right item, use “Overturn”. Otherwise add a note to the case explaining why it stands.
            </Text>
          </Alert>
        )}

        {d.status === "RETURN_REVIEW" && (
          <Alert color={roleColor.review} icon={<AlertTriangle size={16} />} title="The renter placed an item for the return">
            <Text size="sm">
              Review it in{" "}
              <Anchor component={Link} href="/verifications" size="sm">
                Condition checks
              </Anchor>
              . Approve closes this case and the owner is told their item is back; Reject opens a second-offence case.
            </Text>
          </Alert>
        )}

        <Grid>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder radius="md" padding="lg" h="100%">
              <Group gap="xs" mb="xs">
                <Clock size={18} />
                <Text fw={700}>Deadline</Text>
              </Group>
              <Text size="xl" fw={800} c={cd.overdue && active ? "red" : undefined}>
                {active ? cd.text : "Closed"}
              </Text>
              <Text size="sm" c="dimmed">
                {when(d.deadlineAt)} ({d.deadlineHours} h)
              </Text>
              {active && d.offense < 2 && (
                <Stack gap={4} mt="md">
                  <Text size="xs" c="dimmed">
                    Set the deadline (from the opening)
                  </Text>
                  <SegmentedControl
                    value={String(d.deadlineHours)}
                    data={[
                      { value: "24", label: "1 day" },
                      { value: "48", label: "2 days" },
                      { value: "72", label: "3 days" },
                    ]}
                    onChange={(v) =>
                      void act("deadline", () => api.post(`/admin/disputes/${d.id}/deadline`, { hours: Number(v) }), "Deadline updated; the renter was told")
                    }
                  />
                </Stack>
              )}
              {d.offense >= 2 && (
                <Text size="xs" c="dimmed" mt="md">
                  A repeat offence is always 24 hours.
                </Text>
              )}
              <Text size="xs" c="dimmed" mt="md">
                Reminders sent up to stage {d.reminderStage} of 3 (day 0, day 1, day 2, deadline).
              </Text>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder radius="md" padding="lg" h="100%">
              <Group gap="xs" mb="xs">
                <Banknote size={18} />
                <Text fw={700}>Fees</Text>
                {c.money.frozen && (
                  <Badge color="blue" variant="light">
                    Frozen
                  </Badge>
                )}
              </Group>
              <Text size="xl" fw={800}>
                {pesoFmt.format(c.money.owed)} owed
              </Text>
              <Text size="sm" c="dimmed">
                accrued {pesoFmt.format(c.money.statement.accrued)} over {c.money.statement.days} day(s) · paid {pesoFmt.format(c.money.paid)}
                {c.money.pending > 0 ? ` · ${pesoFmt.format(c.money.pending)} pending` : ""}
                {c.money.lateFeeCredit > 0 ? ` · late fees already recorded ${pesoFmt.format(c.money.lateFeeCredit)}` : ""}
              </Text>
              <Divider my="sm" />
              <Text size="xs" c="dimmed">
                Base {pesoFmt.format(c.money.feeBase)}/day from {when(c.money.feeStartAt)}. Cap {pesoFmt.format(c.money.feeCap)}{" "}
                {c.money.feeCapSource === "REPLACEMENT_VALUE"
                  ? "(the item's replacement value)"
                  : "(the larger of the deposit and 30 days' price: the owner has not stated a replacement value)"}
                .
              </Text>
              <Table mt="xs" fz="xs" withRowBorders={false}>
                <Table.Tbody>
                  {c.money.schedule.map((b) => (
                    <Table.Tr key={b.fromDay}>
                      <Table.Td>
                        Days {b.fromDay}
                        {b.toDay ? `-${b.toDay}` : "+"}
                      </Table.Td>
                      <Table.Td>{b.multiplier}x</Table.Td>
                      <Table.Td>{pesoFmt.format(b.perDay)}/day</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {active && !c.money.frozen && !c.money.statement.capped && (
                <Text size="xs" c="dimmed">
                  Tomorrow adds {pesoFmt.format(c.money.statement.nextDayCharge)}.
                </Text>
              )}
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder radius="md" padding="lg" h="100%">
              <Group gap="xs" mb="xs">
                <Lock size={18} />
                <Text fw={700}>The renter&apos;s wrong item</Text>
              </Group>
              {!c.wrongItem ? (
                <Text size="sm" c="dimmed">
                  Not recorded in any locker. Check the bay.
                </Text>
              ) : (
                <Stack gap={4}>
                  <Text size="xl" fw={800}>
                    Locker {c.wrongItem.lockerNumber ?? "?"}, {c.wrongItem.door === "bottom_door" ? "lower" : "upper"} door
                  </Text>
                  <Text size="sm">
                    {c.wrongItem.collectedAt
                      ? `Collected by the renter ${when(c.wrongItem.collectedAt)}.`
                      : c.wrongItem.moving
                        ? "Moving to the lower compartment (waiting for the kiosk to confirm)."
                        : "Waiting for the renter. They collect it with QR + face, any time, without paying."}
                  </Text>
                  {!c.wrongItem.collectedAt && !c.wrongItem.moving && c.wrongItem.door === "main_door" && (
                    <Button
                      mt="sm"
                      size="xs"
                      color="orange"
                      variant="light"
                      loading={busy === "drop"}
                      onClick={() => {
                        if (
                          window.confirm(
                            `This drives the actuator: it moves the item in locker ${c.wrongItem!.lockerNumber} from the upper to the lower compartment (about 20 s). Only do it with the bay clear. Continue?`,
                          )
                        ) {
                          void act("drop", () => api.post(`/admin/disputes/${d.id}/drop-wrong-item`), "Drop sent");
                        }
                      }}
                    >
                      Drop it to the lower compartment now
                    </Button>
                  )}
                </Stack>
              )}
            </Card>
          </Grid.Col>
        </Grid>

        <Grid>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Card withBorder radius="md" padding="lg" h="100%">
              <Group gap="xs" mb="xs">
                <Bot size={18} />
                <Text fw={700}>What the AI saw</Text>
                {c.aiVerdict && (
                  <Badge variant="light" color="gray">
                    {c.aiVerdict.source === "full" ? "full check" : c.aiVerdict.source === "quick" ? "quick check" : "no check"}
                  </Badge>
                )}
              </Group>
              {c.aiVerdict ? (
                <>
                  <Text fw={600}>{c.aiVerdict.headline}</Text>
                  <Stack gap={2} mt="xs">
                    {c.aiVerdict.points.map((p) => (
                      <Text key={p} size="sm">
                        • {p}
                      </Text>
                    ))}
                  </Stack>
                </>
              ) : (
                <Text size="sm" c="dimmed">
                  No AI check is on record for this return.
                </Text>
              )}
              {r.verification && (
                <SimpleGrid cols={{ base: 2, sm: 4 }} mt="md">
                  {(r.item.images ?? []).slice(0, 2).map((src, i) => (
                    <Stack key={`l${i}`} gap={2}>
                      <Image src={src} radius="sm" h={100} fit="cover" alt={`Listing photo ${i + 1}`} />
                      <Text size="xs" c="dimmed">
                        Listing {i + 1}
                      </Text>
                    </Stack>
                  ))}
                  {(r.verification.kioskImages ?? []).slice(0, 2).map((src, i) => (
                    <Stack key={`k${i}`} gap={2}>
                      <Image src={src} radius="sm" h={100} fit="cover" alt={`Locker photo ${i + 1}`} />
                      <Text size="xs" c="dimmed">
                        Locker {i + 1}
                      </Text>
                    </Stack>
                  ))}
                </SimpleGrid>
              )}
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder radius="md" padding="lg" h="100%">
              <Group gap="xs" mb="xs">
                <User size={18} />
                <Text fw={700}>People</Text>
              </Group>
              <Text size="sm" fw={700}>
                Renter: {r.renter.firstName} {r.renter.lastName} ({r.renter.studentId})
              </Text>
              <Text size="sm">
                <Mail size={12} /> {r.renter.email} · <Phone size={12} /> {r.renter.phoneNumber}
              </Text>
              <Text size="sm" mt={4}>
                Guardian:{" "}
                {r.renter.parentName ? (
                  <b>
                    {r.renter.parentName}
                    {r.renter.parentContact ? `, ${r.renter.parentContact}` : ""}
                  </b>
                ) : (
                  <Text span c="red" size="sm" fw={600}>
                    not on record
                  </Text>
                )}
              </Text>
              {r.renter.restrictedUntilReviewAt && (
                <Alert color="red" variant="light" mt="sm" p="xs">
                  <Text size="xs">Suspended until reviewed: {r.renter.restrictionNote}</Text>
                  <Button size="xs" mt={6} variant="white" color="red" onClick={() => setLiftOpen(true)}>
                    I have reviewed the account: lift
                  </Button>
                </Alert>
              )}
              <Divider my="sm" />
              <Text size="sm" fw={700}>
                Owner: {r.owner.firstName} {r.owner.lastName} ({r.owner.studentId})
              </Text>
              <Text size="sm">
                {r.owner.email} · {r.owner.phoneNumber}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                The owner is out of the dispute: payout held, told only when their item is back.
              </Text>
              <Divider my="sm" />
              <Text size="xs" c="dimmed">
                Rented {when(r.startDate)} to {when(r.endDate)} · returned {when(r.returnedAt)}
                {r.returnLocker ? `, locker ${r.returnLocker.lockerNumber}` : ""} · {pesoFmt.format(r.totalPrice)} rent,{" "}
                {pesoFmt.format(r.securityDeposit)} deposit
              </Text>
            </Card>
          </Grid.Col>
        </Grid>

        <Grid>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Card withBorder radius="md" padding="lg">
              <Text fw={700} mb="sm">
                Timeline: every message exactly as it was shown
              </Text>
              <Timeline bulletSize={14} lineWidth={2}>
                {c.events.map((e) => (
                  <Timeline.Item
                    key={e.id}
                    color={e.type === "ESCALATED" || e.type === "PAYMENT_REJECTED" ? "red" : e.audience === "OWNER" ? "gray" : "teal"}
                    title={
                      <Group gap={6}>
                        <Text size="sm" fw={600}>
                          {EVENT_LABEL[e.type] ?? e.type}
                        </Text>
                        {e.audience && (
                          <Badge size="xs" variant="outline">
                            {e.audience.toLowerCase()}
                          </Badge>
                        )}
                        {e.channel && (
                          <Badge size="xs" variant="light" color="gray">
                            {e.channel.toLowerCase().replace("_", "-")}
                          </Badge>
                        )}
                        {e.outcome && (
                          <Badge size="xs" color={e.outcome.startsWith("NOT_SENT") ? "red" : "blue"} variant="light">
                            {e.outcome.toLowerCase().replace(/_/g, " ")}
                          </Badge>
                        )}
                      </Group>
                    }
                  >
                    <Text size="xs" c="dimmed">
                      {when(e.createdAt)} · {e.actorRole.toLowerCase()}
                    </Text>
                    {e.title && (
                      <Text size="sm" fw={600}>
                        “{e.title}”
                      </Text>
                    )}
                    {e.message && (
                      <>
                        <Anchor size="xs" onClick={() => setOpenEvent(openEvent === e.id ? null : e.id)}>
                          {openEvent === e.id ? "Hide" : "Show"} the exact text
                        </Anchor>
                        <Collapse in={openEvent === e.id}>
                          <Card withBorder p="sm" mt={4} bg="var(--color-surface)">
                            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                              {e.message}
                            </Text>
                          </Card>
                        </Collapse>
                      </>
                    )}
                  </Timeline.Item>
                ))}
              </Timeline>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack>
              <Card withBorder radius="md" padding="lg">
                <Group gap="xs" mb="xs">
                  <Phone size={18} />
                  <Text fw={700}>Log a contact attempt</Text>
                </Group>
                <Text size="xs" c="dimmed" mb="sm">
                  The system cannot phone anyone. Personnel call, then record it here; it goes into the letters.
                </Text>
                <SimpleGrid cols={3}>
                  <Select
                    label="Who"
                    value={contact.audience}
                    onChange={(v) => setContact({ ...contact, audience: v ?? "RENTER" })}
                    data={[
                      { value: "RENTER", label: "Renter" },
                      { value: "GUARDIAN", label: "Guardian" },
                      { value: "OWNER", label: "Owner" },
                      { value: "SAO", label: "SAO" },
                      { value: "ENGINEERING", label: "Engineering" },
                      { value: "GUIDANCE", label: "Guidance" },
                    ]}
                  />
                  <Select
                    label="How"
                    value={contact.channel}
                    onChange={(v) => setContact({ ...contact, channel: v ?? "PHONE" })}
                    data={["PHONE", "SMS", "EMAIL", "IN_PERSON", "LETTER"].map((v) => ({ value: v, label: v.replace("_", " ").toLowerCase() }))}
                  />
                  <Select
                    label="Outcome"
                    value={contact.outcome}
                    onChange={(v) => setContact({ ...contact, outcome: v ?? "OTHER" })}
                    data={["REACHED", "NO_ANSWER", "LEFT_MESSAGE", "WRONG_NUMBER", "SUBMITTED", "OTHER"].map((v) => ({
                      value: v,
                      label: v.replace(/_/g, " ").toLowerCase(),
                    }))}
                  />
                </SimpleGrid>
                <Textarea
                  mt="xs"
                  placeholder="What was said or agreed"
                  value={contact.note}
                  onChange={(e) => setContact({ ...contact, note: e.currentTarget.value })}
                  autosize
                  minRows={2}
                />
                <Button
                  mt="xs"
                  size="xs"
                  loading={busy === "contact"}
                  onClick={() =>
                    void act("contact", () => api.post(`/admin/disputes/${d.id}/contact`, contact), "Contact attempt logged").then(
                      (ok) => ok && setContact({ ...contact, note: "" }),
                    )
                  }
                >
                  Log it
                </Button>
              </Card>

              <Card withBorder radius="md" padding="lg">
                <Group gap="xs" mb="xs">
                  <FileText size={18} />
                  <Text fw={700}>Letters to UCLM</Text>
                </Group>
                <Text size="xs" c="dimmed" mb="sm">
                  Generated for an admin to review, sign and submit. Each generation and submission is logged.
                </Text>
                <Group gap="xs">
                  {(["SAO", "ENGINEERING", "GUIDANCE"] as const).map((o) => (
                    <Button
                      key={o}
                      size="xs"
                      variant="light"
                      loading={busy === `letter-${o}`}
                      onClick={() => void act(`letter-${o}`, () => api.post(`/admin/disputes/${d.id}/letters`, { office: o }), "Letter generated")}
                    >
                      {o === "ENGINEERING" ? "Engineering" : o === "GUIDANCE" ? "Guidance" : "SAO"}
                    </Button>
                  ))}
                </Group>
                <Stack gap={6} mt="sm">
                  {c.letters.length === 0 && (
                    <Text size="sm" c="dimmed">
                      None yet. They are generated automatically when the case escalates.
                    </Text>
                  )}
                  {c.letters.map((l) => (
                    <Group key={l.id} justify="space-between">
                      <div>
                        <Text size="sm" fw={600}>
                          {l.referenceNo} · {OFFICE_LABEL[l.office] ?? l.office}
                        </Text>
                        <Text size="xs" c="dimmed">
                          generated {when(l.generatedAt)}
                          {l.submittedAt ? ` · submitted ${when(l.submittedAt)}` : " · not submitted"}
                        </Text>
                      </div>
                      <Group gap={4}>
                        <Button size="xs" variant="subtle" component={Link} href={`/disputes/${d.id}/letters/${l.id}`} target="_blank">
                          View / print
                        </Button>
                        {!l.submittedAt && (
                          <Button
                            size="xs"
                            variant="light"
                            color="teal"
                            loading={busy === `sub-${l.id}`}
                            onClick={() => {
                              const n = window.prompt("How and to whom was it submitted? (optional)") ?? "";
                              void act(`sub-${l.id}`, () => api.post(`/admin/disputes/letters/${l.id}/submitted`, { note: n || undefined }), "Marked as submitted");
                            }}
                          >
                            Mark submitted
                          </Button>
                        )}
                      </Group>
                    </Group>
                  ))}
                </Stack>
              </Card>

              <Card withBorder radius="md" padding="lg">
                <Text fw={700} mb="xs">
                  Add a note
                </Text>
                <Textarea value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={2} />
                <Button
                  mt="xs"
                  size="xs"
                  variant="light"
                  disabled={!note.trim()}
                  loading={busy === "note"}
                  onClick={() => void act("note", () => api.post(`/admin/disputes/${d.id}/note`, { note }), "Note added").then((ok) => ok && setNote(""))}
                >
                  Add
                </Button>
              </Card>

              <Card withBorder radius="md" padding="lg">
                <Text fw={700} mb="xs">
                  Money on this rental
                </Text>
                <Table fz="xs">
                  <Table.Tbody>
                    {c.transactions.map((t) => (
                      <Table.Tr key={t.id}>
                        <Table.Td>{t.type.replace(/_/g, " ").toLowerCase()}</Table.Td>
                        <Table.Td>{pesoFmt.format(t.amount)}</Table.Td>
                        <Table.Td>{t.status.toLowerCase()}</Table.Td>
                        <Table.Td>{t.paymentMethod}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>
      </Stack>

      <Modal opened={closeMode !== null} onClose={() => setCloseMode(null)} title={closeMode === "OVERTURNED" ? "Overturn the dispute" : "Close as unrecovered"}>
        <Stack>
          <Alert color={closeMode === "OVERTURNED" ? "teal" : "red"} icon={<ShieldAlert size={16} />}>
            {closeMode === "OVERTURNED"
              ? "The item in the locker was the correct one. Fees paid on this case are refunded (ledger), the restriction lifts, and the item is handed to the owner as an approved return."
              : "The correct item is not coming back. The owner's claim of the item's full value is recorded and the renter's account is banned. Both are told."}
          </Alert>
          <Textarea label="Why (required, shown in the case log)" value={closeNote} onChange={(e) => setCloseNote(e.currentTarget.value)} autosize minRows={3} />
          <Button
            color={closeMode === "OVERTURNED" ? "teal" : "red"}
            disabled={closeNote.trim().length < 5}
            loading={busy === "close"}
            onClick={() =>
              void act("close", () => api.post(`/admin/disputes/${d.id}/close`, { resolution: closeMode, note: closeNote }), "Case closed").then(
                (ok) => ok && setCloseMode(null),
              )
            }
          >
            Confirm
          </Button>
        </Stack>
      </Modal>

      <Modal opened={resendOpen} onClose={() => setResendOpen(false)} title="Re-send the case details to the renter">
        <Stack>
          <Text size="sm">The renter is sent the full, current prompt (amount owed now, deadline, steps). It is logged word for word.</Text>
          <Textarea
            label="Preface (optional), e.g. a correction"
            value={preface}
            onChange={(e) => setPreface(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Button
            loading={busy === "resend"}
            onClick={() =>
              void act("resend", () => api.post(`/admin/disputes/${d.id}/resend-prompt`, { preface: preface || undefined }), "Sent").then(
                (ok) => ok && (setResendOpen(false), setPreface("")),
              )
            }
          >
            Send
          </Button>
        </Stack>
      </Modal>

      <Modal opened={liftOpen} onClose={() => setLiftOpen(false)} title="Lift the suspension">
        <Stack>
          <Textarea label="What you reviewed (required)" value={liftNote} onChange={(e) => setLiftNote(e.currentTarget.value)} autosize minRows={2} />
          <Button
            disabled={liftNote.trim().length < 5}
            loading={busy === "lift"}
            onClick={() =>
              void act("lift", () => api.post(`/admin/users/${r.renter.id}/lift-restriction`, { note: liftNote }), "Suspension lifted").then(
                (ok) => ok && setLiftOpen(false),
              )
            }
          >
            Lift
          </Button>
        </Stack>
      </Modal>
    </AdminLayout>
  );
}
