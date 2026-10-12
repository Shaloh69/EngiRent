"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Anchor,
  Badge,
  Blockquote,
  Button,
  Card,
  Divider,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  Textarea,
  Timeline,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { AlertCircle, ArrowLeft, Banknote, Camera, CheckCircle2, Clock, Gavel, Info, Repeat, Scale, Video } from "lucide-react";
import api from "@/lib/api";
import { useAdminRefetch } from "@/lib/useAdminSocket";
import { roleColor } from "../../theme";
import {
  CONCERN_STATUS_COLOR,
  CONCERN_STATUS_LABEL,
  ConcernDetail,
  ConcernEvidenceRow,
  ConcernPreview,
  countdown,
  KIND_EXPLAINED,
  OPEN_CONCERN_STATUSES,
  partyLabel,
  pesoFmt,
  RESPONSIBLE_PARTY,
  when,
} from "@/lib/concerns";

/** Concerns v2 — one case: both sides' evidence, the photos on file, and the decision. */
export default function ConcernCasePage() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<ConcernDetail | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/concerns/${id}`);
      setC(res.data.data);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load the case.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useAdminRefetch(["admin:concern"], () => void load());

  if (error) {
    return (
      <AdminLayout>
        <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
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

  const open = OPEN_CONCERN_STATUSES.includes(c.status);
  const reporterEv = c.evidence.filter((e) => e.authorParty === c.reporterParty);
  const respondentEv = c.evidence.filter((e) => e.authorParty && e.authorParty !== c.reporterParty);
  const respondentParty = c.reporterParty === "RENTER" ? "OWNER" : "RENTER";
  const due = countdown(c.responseDueAt);

  return (
    <AdminLayout>
      <Stack gap="lg">
        <Anchor component={Link} href="/concerns" size="sm">
          <Group gap={4}>
            <ArrowLeft size={14} /> All concerns
          </Group>
        </Anchor>

        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="sm">
              <Title order={2}>{c.referenceNo}</Title>
              <Badge size="lg" color={CONCERN_STATUS_COLOR[c.status]} variant="light">
                {CONCERN_STATUS_LABEL[c.status]}
              </Badge>
              {c.repeatFlag && (
                <Badge size="lg" color={roleColor.cta} variant="light" leftSection={<Repeat size={12} />}>
                  Repeat case
                </Badge>
              )}
            </Group>
            <Text fw={700} mt={4}>
              {c.title} · {c.rental.item.title}
            </Text>
            <Text size="sm" c="dimmed">
              {KIND_EXPLAINED[c.kind]} Reported by {c.reporter.firstName} {c.reporter.lastName} ({partyLabel(c.reporterParty).toLowerCase()}) on{" "}
              {when(c.createdAt)}.{" "}
              <Anchor component={Link} href={`/rentals/${c.rental.id}`} size="sm">
                Open the rental
              </Anchor>
            </Text>
          </div>
        </Group>

        <WhatNow c={c} due={due} />

        {c.priorUpheldAgainstRespondent > 0 && (
          <Alert icon={<Repeat size={16} />} color={roleColor.cta} variant="light" title="History">
            {c.respondent.firstName} {c.respondent.lastName} already has {c.priorUpheldAgainstRespondent} upheld case
            {c.priorUpheldAgainstRespondent === 1 ? "" : "s"} in the last 90 days. A second upheld case flags them for review.
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <SideCard
            title={`${partyLabel(c.reporterParty)}'s report`}
            person={`${c.reporter.firstName} ${c.reporter.lastName} · ${c.reporter.studentId}`}
            evidence={reporterEv}
            onZoom={setZoom}
            empty="No evidence on file."
          />
          <SideCard
            title={`${partyLabel(respondentParty)}'s answer`}
            person={`${c.respondent.firstName} ${c.respondent.lastName} · ${c.respondent.studentId}`}
            evidence={respondentEv}
            onZoom={setZoom}
            empty={
              c.respondedAt
                ? "Answered without photos or video."
                : open
                  ? `No answer yet. They have until ${when(c.responseDueAt)} (${due.text}).`
                  : "They did not answer."
            }
          />
        </SimpleGrid>

        <Card withBorder radius="md" padding="lg">
          <Group gap="xs" mb="xs">
            <Camera size={16} />
            <Text fw={700}>Photos already on file</Text>
          </Group>
          <Text size="sm" c="dimmed" mb="sm">
            What the item looked like when it was listed, and what the locker camera saw at the deposit and at the return. Compare them with the students&apos; photos.
          </Text>
          <PhotoRow title="Listing photos (what the owner promised)" urls={c.lockerPhotos.listing.images ?? []} onZoom={setZoom} />
          <PhotoRow title={`Locker camera at the deposit${c.lockerPhotos.deposit.at ? ` · ${when(c.lockerPhotos.deposit.at)}` : ""}`} urls={c.lockerPhotos.deposit.kioskImages ?? []} onZoom={setZoom} />
          <PhotoRow title={`Locker camera at the return${c.lockerPhotos.return.at ? ` · ${when(c.lockerPhotos.return.at)}` : ""}`} urls={c.lockerPhotos.return.kioskImages ?? []} onZoom={setZoom} />
        </Card>

        <MoneyFacts c={c} />

        {c.pendingPayment && <PaymentCard c={c} onDone={load} />}

        {open && c.kind !== "RETURN_CHECK" && <DecisionPanel c={c} onDone={load} />}
        {open && c.kind === "RETURN_CHECK" && <ReturnCheckPanel c={c} onDone={load} />}
        {!open && <DecidedCard c={c} />}

        <Card withBorder radius="md" padding="lg">
          <Text fw={700} mb="sm">
            Timeline: everything both students were told
          </Text>
          <Timeline bulletSize={14} lineWidth={2}>
            {c.events.map((e) => (
              <Timeline.Item key={e.id} title={`${e.actor === "SYSTEM" ? "System" : e.actor === "ADMIN" ? "Admin" : partyLabel(e.actor as "RENTER" | "OWNER")} · ${when(e.createdAt)}`}>
                <Text size="sm">{e.message}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Card>
      </Stack>

      <Modal opened={zoom !== null} onClose={() => setZoom(null)} size="xl" title="Photo" centered>
        {zoom && <Image src={zoom} alt="Evidence, full size" fit="contain" mah="75vh" />}
      </Modal>
    </AdminLayout>
  );
}

function WhatNow({ c, due }: { c: ConcernDetail; due: { text: string; overdue: boolean } }) {
  if (c.status === "AWAITING_RESPONSE") {
    return (
      <Alert icon={<Clock size={16} />} color={roleColor.review} variant="light" title="Waiting for the other student">
        {c.respondent.firstName} can answer with their own photos or video until {when(c.responseDueAt)} ({due.text}). You may decide earlier if the evidence is already clear;
        they will be told either way.
      </Alert>
    );
  }
  if (c.status === "UNDER_REVIEW") {
    return (
      <Alert icon={<Gavel size={16} />} color={roleColor.warning} variant="light" title="Ready for your decision">
        {c.respondedAt ? `${c.respondent.firstName} answered on ${when(c.respondedAt)}.` : "The 24 hours to answer passed without an answer."} Compare both sides with the photos on file, then
        set how much {c.kind === "DEFECT_ON_RECEIPT" ? "the owner" : "the renter"} is responsible below.
      </Alert>
    );
  }
  return null;
}

function SideCard({
  title,
  person,
  evidence,
  onZoom,
  empty,
}: {
  title: string;
  person: string;
  evidence: ConcernEvidenceRow[];
  onZoom: (u: string) => void;
  empty: string;
}) {
  const statement = evidence.find((e) => e.type === "STATEMENT");
  const photos = evidence.filter((e) => e.type === "PHOTO" && e.url);
  const videos = evidence.filter((e) => e.type === "VIDEO" && e.url);
  return (
    <Card withBorder radius="md" padding="lg">
      <Text fw={700}>{title}</Text>
      <Text size="xs" c="dimmed" mb="sm">
        {person}
        {statement ? ` · ${when(statement.createdAt)}` : ""}
      </Text>
      {!statement && photos.length === 0 && videos.length === 0 ? (
        <Text size="sm" c="dimmed">
          {empty}
        </Text>
      ) : (
        <Stack gap="sm">
          {statement && (
            <Blockquote color="gray" p="sm" style={{ whiteSpace: "pre-wrap" }}>
              {statement.text}
            </Blockquote>
          )}
          {photos.length > 0 && (
            <SimpleGrid cols={{ base: 2, sm: 3 }}>
              {photos.map((p, i) => (
                <Image
                  key={p.id}
                  src={p.url!}
                  alt={`${title}: photo ${i + 1}`}
                  radius="sm"
                  h={120}
                  fit="cover"
                  style={{ cursor: "zoom-in" }}
                  onClick={() => onZoom(p.url!)}
                />
              ))}
            </SimpleGrid>
          )}
          {videos.map((v) => (
            <Stack key={v.id} gap={4}>
              <Group gap={4}>
                <Video size={14} />
                <Text size="xs" c="dimmed">
                  Video{v.sizeBytes ? ` · ${(v.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}
                </Text>
              </Group>
              <video src={v.url!} controls preload="metadata" style={{ width: "100%", maxHeight: 360, borderRadius: 8, background: "#000" }} />
            </Stack>
          ))}
          {photos.length === 0 && videos.length === 0 && (
            <Text size="xs" c="dimmed">
              No photos or video with this side.
            </Text>
          )}
        </Stack>
      )}
    </Card>
  );
}

function PhotoRow({ title, urls, onZoom }: { title: string; urls: string[]; onZoom: (u: string) => void }) {
  return (
    <Stack gap={4} mb="sm">
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
        {title}
      </Text>
      {urls.length === 0 ? (
        <Text size="sm" c="dimmed">
          None on file.
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 3, sm: 6 }}>
          {urls.slice(0, 6).map((u, i) => (
            <Image key={u + i} src={u} alt={`${title} ${i + 1}`} radius="sm" h={90} fit="cover" style={{ cursor: "zoom-in" }} onClick={() => onZoom(u)} />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

function MoneyFacts({ c }: { c: ConcernDetail }) {
  const f = c.preview.facts;
  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="xs">
        <Banknote size={16} />
        <Text fw={700}>Money on this rental</Text>
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Fact label="Rent paid" value={pesoFmt.format(f.rent)} />
        <Fact label="Deposit paid" value={pesoFmt.format(f.deposit)} />
        <Fact
          label="Deposit still held"
          value={f.depositRefunded ? "Refunded" : c.rental.depositHoldUntil ? `${pesoFmt.format(f.depositAvailable)} until ${when(c.rental.depositHoldUntil)}` : "Not held"}
        />
        <Fact
          label="Damage cap"
          value={`${pesoFmt.format(f.cap.cap)} (${f.cap.source === "REPLACEMENT_VALUE" ? "owner's replacement value" : "deposit or 30 days of rent"})`}
        />
      </SimpleGrid>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={600} tt="uppercase">
        {label}
      </Text>
      <Text size="sm" fw={600}>
        {value}
      </Text>
    </div>
  );
}

function DecisionPanel({ c, onDone }: { c: ConcernDetail; onDone: () => void }) {
  const isDamage = c.kind === "DAMAGE_ON_RETURN";
  const who = RESPONSIBLE_PARTY[c.kind];
  const [pct, setPct] = useState<number>(100);
  // Empty on purpose: the admin types what the damage is worth (a pre-filled cap
  // would make every case look like the maximum).
  const [assessed, setAssessed] = useState<number | string>("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<ConcernPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // The preview is the server's own calculation: what you see is what will move.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await api.post(`/admin/concerns/${c.id}/preview`, {
          pct,
          assessedAmount: isDamage ? Number(assessed) || 0 : null,
        });
        setPreview(res.data.data);
      } catch {
        setPreview(null);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [c.id, pct, assessed, isDamage]);

  const decide = async () => {
    setSaving(true);
    try {
      await api.post(`/admin/concerns/${c.id}/decide`, { pct, assessedAmount: isDamage ? Number(assessed) || 0 : null, note });
      notifications.show({ color: "teal", message: "Decided. Both students have been told in the app and by email." });
      setConfirming(false);
      onDone();
    } catch (e: any) {
      notifications.show({ color: "red", message: e?.response?.data?.error || "Could not save the decision" });
    } finally {
      setSaving(false);
    }
  };

  const noteOk = note.trim().length >= 20;
  const amountOk = !isDamage || pct === 0 || Number(assessed) > 0;
  const presets = useMemo(() => ["0", "25", "50", "75", "100"], []);

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb={4}>
        <Scale size={16} />
        <Text fw={700}>Your decision</Text>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Set how much the {who} is responsible, based on both sides&apos; evidence. 0% means not responsible at all; 100% means fully responsible.
        {isDamage ? " Enter what the damage is worth (it can never exceed the cap above)." : " The refund is based on the whole rent if the problem was reported within 3 hours of pickup, otherwise on the days not yet used."}
      </Text>

      <Stack gap="md">
        <div>
          <Text size="sm" fw={600} mb={4}>
            The {who} is responsible for: {pct}%
          </Text>
          <SegmentedControl value={String(pct)} onChange={(v) => setPct(Number(v))} data={presets.map((p) => ({ value: p, label: `${p}%` }))} mb="xs" />
          <Slider value={pct} onChange={setPct} min={0} max={100} step={5} label={(v) => `${v}%`} />
        </div>

        {isDamage && (
          <NumberInput
            label="What the damage is worth"
            description={`Repair or replacement cost. Capped at ${pesoFmt.format(c.preview.facts.cap.cap)}.`}
            value={assessed}
            onChange={setAssessed}
            min={0}
            max={c.preview.facts.cap.cap}
            prefix="₱"
            decimalScale={2}
            thousandSeparator=","
            placeholder="Type the amount"
            error={!amountOk ? "Enter what the damage is worth" : undefined}
          />
        )}

        <Card withBorder radius="md" padding="md" bg="var(--mantine-color-default-hover)">
          <Group gap="xs" mb="xs">
            <Info size={14} />
            <Text size="sm" fw={700}>
              What will happen, and what both students will read
            </Text>
          </Group>
          {!preview ? (
            <Loader size="sm" />
          ) : (
            <Stack gap={6}>
              {isDamage ? (
                <SimpleGrid cols={{ base: 2, sm: 4 }}>
                  <Fact label="Charged to the renter" value={pesoFmt.format(preview.charge ?? 0)} />
                  <Fact label="From the held deposit" value={pesoFmt.format(preview.fromDeposit ?? 0)} />
                  <Fact label="Still owed" value={pesoFmt.format(preview.owed ?? 0)} />
                  <Fact label="Deposit back to renter" value={pesoFmt.format(preview.depositBack ?? 0)} />
                </SimpleGrid>
              ) : (
                <SimpleGrid cols={{ base: 2, sm: 3 }}>
                  <Fact label="Rent given back" value={pesoFmt.format(preview.refund ?? 0)} />
                  <Fact label="Refund based on" value={preview.fullBecauseEarly ? "the whole rent (within 3 h)" : `the unused days (${pesoFmt.format(preview.refundBase ?? 0)})`} />
                  <Fact label="Return the item by" value={preview.returnBy ? when(preview.returnBy) : "no change"} />
                </SimpleGrid>
              )}
              {preview.capped && (
                <Text size="xs" c={roleColor.warning}>
                  The amount was reduced to the cap.
                </Text>
              )}
              <Text size="sm" mt={4}>
                {preview.explanation}
              </Text>
            </Stack>
          )}
        </Card>

        <Textarea
          label="Your explanation (both students read it)"
          description="Say what in the evidence decided it, in plain words. At least 20 characters."
          placeholder="e.g. The renter's video shows the screen dark at pickup, and the owner's listing photos are older than the last rental."
          minRows={3}
          autosize
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          error={note.length > 0 && !noteOk ? "At least 20 characters" : undefined}
        />

        <Group justify="flex-end">
          <Button leftSection={<Gavel size={16} />} color={roleColor.cta} disabled={!noteOk || !amountOk || !preview} onClick={() => setConfirming(true)}>
            Decide
          </Button>
        </Group>
      </Stack>

      <Modal opened={confirming} onClose={() => setConfirming(false)} title={`Decide ${c.referenceNo}?`} centered>
        <Stack gap="sm">
          <Text size="sm">{preview?.explanation}</Text>
          <Text size="sm" c="dimmed">
            The money moves now and both students are told in the app and by email. This cannot be undone from the console.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button color={roleColor.cta} loading={saving} onClick={() => void decide()}>
              Confirm decision
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

function ReturnCheckPanel({ c, onDone }: { c: ConcernDetail; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const close = async () => {
    setSaving(true);
    try {
      await api.post(`/admin/concerns/${c.id}/decide`, { pct: 0, note });
      notifications.show({ color: "teal", message: "Closed. Both students have been told." });
      onDone();
    } catch (e: any) {
      notifications.show({ color: "red", message: e?.response?.data?.error || "Could not close it" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb={4}>
        <Scale size={16} />
        <Text fw={700}>Settled by the return check</Text>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        Decide the return itself in{" "}
        <Anchor component={Link} href="/verifications">
          Condition checks
        </Anchor>
        : approving or rejecting it closes this concern and tells both students. Close it here only if it needs no decision on the return.
      </Text>
      <Textarea label="Note to both students (at least 20 characters)" minRows={2} autosize value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <Group justify="flex-end" mt="sm">
        <Button variant="default" disabled={note.trim().length < 20} loading={saving} onClick={() => void close()}>
          Close without a decision on the return
        </Button>
      </Group>
    </Card>
  );
}

function PaymentCard({ c, onDone }: { c: ConcernDetail; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const p = c.pendingPayment!;
  const confirm = async () => {
    setSaving(true);
    try {
      await api.post(`/admin/concerns/${c.id}/confirm-payment`);
      notifications.show({ color: "teal", message: "Payment confirmed. The renter's account limit is lifted." });
      onDone();
    } catch (e: any) {
      notifications.show({ color: "red", message: e?.response?.data?.error || "Could not confirm" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Alert icon={<Banknote size={16} />} color={roleColor.warning} variant="light" title="A payment is waiting for you">
      <Stack gap="xs">
        <Text size="sm">
          The renter says they sent {pesoFmt.format(p.amount)} with reference <b>{p.paymentReferenceNo ?? "—"}</b> on {when(p.createdAt)}. Check that it arrived, then confirm. Their
          account stays limited until you do.
        </Text>
        <Group>
          <Button size="xs" color={roleColor.success} loading={saving} leftSection={<CheckCircle2 size={14} />} onClick={() => void confirm()}>
            It arrived: confirm
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

function DecidedCard({ c }: { c: ConcernDetail }) {
  const isDamage = c.kind === "DAMAGE_ON_RETURN";
  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="xs">
        <Gavel size={16} />
        <Text fw={700}>{c.status === "CLOSED" ? "Closed" : "Decision"}</Text>
        {c.decidedAt && (
          <Text size="sm" c="dimmed">
            {when(c.decidedAt)}
          </Text>
        )}
      </Group>
      {c.status !== "CLOSED" && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} mb="sm">
          <Fact label={`${RESPONSIBLE_PARTY[c.kind]} responsible`} value={`${c.responsibilityPct ?? 0}%`} />
          {isDamage ? (
            <>
              <Fact label="Damage assessed" value={pesoFmt.format(c.assessedAmount ?? 0)} />
              <Fact label="From the deposit" value={pesoFmt.format(c.fromDeposit ?? 0)} />
              <Fact label="Owed" value={(c.amountOwed ?? 0) > 0 ? `${pesoFmt.format(c.amountOwed ?? 0)}${c.owedPaidAt ? " (paid)" : ""}` : "—"} />
            </>
          ) : (
            <Fact label="Rent given back" value={pesoFmt.format(c.refundAmount ?? 0)} />
          )}
        </SimpleGrid>
      )}
      {c.decisionNote && (
        <>
          <Divider mb="sm" />
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            Explanation sent to both students
          </Text>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {c.decisionNote}
          </Text>
        </>
      )}
    </Card>
  );
}
