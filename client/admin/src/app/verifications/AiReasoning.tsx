"use client";

import { Alert, Badge, Card, Group, Progress, Stack, Text } from "@mantine/core";
import { AlertCircle, BrainCircuit } from "lucide-react";
import { roleColor } from "../theme";

/**
 * D-114 — the AI's own reasoning, shown to the admin while they decide.
 *
 * The first physical test of the new item check scored a wrong tool 77.87, and
 * the reason had to be back-solved from three stored numbers. The server now
 * keeps the reasoning (`Verification.mlEvidence`, and `deepReviewDetails.evidence`
 * for the full-tier re-run); this renders it in plain words so an admin can see
 * WHY a score is what it is, not only what it is.
 *
 * The reference ranges below are from the real-photo evaluation of 2026-09-25
 * (3 items, 27 captures): they say what a number usually means, not what it
 * must mean. They are quoted, never used to decide anything.
 */

type Json = Record<string, any>;

const PLACEMENT_WORDS: Record<string, { tone: "good" | "warn" | "bad"; text: string }> = {
  OK: { tone: "good", text: "The item was placed well." },
  TRUNCATED: { tone: "warn", text: "Part of the item was outside the camera's view." },
  OFF_CENTER: { tone: "warn", text: "The item was too close to a side of the locker." },
  EMPTY: { tone: "bad", text: "The camera saw no item in the locker." },
  MULTIPLE: { tone: "warn", text: "More than one object was in the locker." },
  UNSEEN: { tone: "bad", text: "The locker was too dark for the camera to see." },
};

const pct = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? Math.round(x * 100) : null;

function Meter({
  label,
  hint,
  value,
  reference,
}: {
  label: string;
  hint: string;
  value: number | null;
  reference: string;
}) {
  return (
    <Stack gap={2}>
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600}>
          {label}
        </Text>
        <Text size="sm" fw={700}>
          {value === null ? "not measured" : `${value}%`}
        </Text>
      </Group>
      {value !== null && <Progress value={value} size="sm" />}
      <Text size="xs" c="dimmed">
        {hint} {reference}
      </Text>
    </Stack>
  );
}

function Block({ title, ev }: { title: string; ev: Json }) {
  const placement: Json = ev.placement ?? {};
  const raw: Json = ev.evidence ?? {};
  const verdict: string = placement.verdict ?? "OK";
  const words = PLACEMENT_WORDS[verdict] ?? { tone: "warn" as const, text: verdict };
  const identity = pct(raw.dino_max);
  const kind = pct(raw.sem_bc);
  const perFrame: string[] = Array.isArray(placement.per_frame) ? placement.per_frame : [];
  const sameVerdict = perFrame.filter((v) => v === verdict).length;
  const edges: string[] = Array.isArray(placement.edges) ? placement.edges : [];
  const stages = ev.stageSeconds && typeof ev.stageSeconds === "object" ? ev.stageSeconds : null;

  // A hint, not a rule: it fires on the signature of the 2026-10-09 lookalike
  // (a different tool read as the right KIND of item, with a weak identity match)
  // and equally on a correct item that was only partly in view. Both deserve a
  // close look at the photographs.
  const lookalikeHint = identity !== null && kind !== null && kind >= 80 && identity < 75;

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="sm" fw={700}>
          {title}
        </Text>
        <Badge variant="light" size="sm">
          {ev.pipeline ?? "v2"} · {ev.mode ?? "?"} check
        </Badge>
        {typeof ev.elapsedSeconds === "number" && (
          <Text size="xs" c="dimmed">
            {ev.elapsedSeconds.toFixed(1)} s
          </Text>
        )}
      </Group>

      <Alert
        variant="light"
        color={words.tone === "good" ? roleColor.success : words.tone === "bad" ? roleColor.critical : roleColor.warning}
        py={6}
      >
        <Text size="sm">
          <b>Placement:</b> {words.text}
          {edges.length > 0 && ` (cut off at the ${edges.join(" and ")} edge)`}
          {perFrame.length > 0 && ` ${sameVerdict} of ${perFrame.length} photos agree.`}
          {ev.reposition === true && " The AI asked for the item to be moved and checked again."}
        </Text>
      </Alert>

      <Meter
        label="Is it the same object as the listing?"
        hint="How closely the item's own pixels match the listing photos, background removed."
        value={identity}
        reference="In our tests correct items scored 65–93% and other items 0–42%."
      />
      <Meter
        label="Is it the same kind of item?"
        hint="Whether the AI reads both photos as the same sort of equipment."
        value={kind}
        reference="A different tool of the same type also scores high here."
      />

      <Meter
        label="Do the colours match?"
        hint="Colour of the item itself, compared with the listing photos. Shown for you to judge: it is not part of the score."
        value={pct(raw.colour)}
        reference="In our tests correct items scored 59–90%, but a few wrong items did too, so it is not used to decide."
      />

      {lookalikeHint && (
        <Alert variant="light" color={roleColor.warning} icon={<AlertCircle size={16} />} py={6}>
          <Text size="sm">
            It looks like the right <b>kind</b> of item but the match to the listing photos is weak.
            This is what a lookalike tool looks like to the AI — and also what a correct item
            partly out of view looks like. Compare the photographs carefully.
          </Text>
        </Alert>
      )}

      <Text size="xs" c="dimmed">
        Combined score {Number(ev.confidence ?? 0).toFixed(1)}%
        {ev.decision ? ` → ${ev.decision}` : ""}
        {raw.stage_set ? ` · scoring model ${raw.stage_set}` : ""}
        {stages
          ? ` · time: ${Object.entries(stages)
              .map(([k, v]) => `${k.replace(/_/g, " ")} ${Number(v).toFixed(1)}s`)
              .join(", ")}`
          : ""}
      </Text>
    </Stack>
  );
}

/** `v` is a Verification row as returned by GET /admin/verifications. */
export function AiReasoning({ v }: { v: any }) {
  const quick: Json | null = v?.mlEvidence ?? null;
  const full: Json | null = v?.deepReviewDetails?.evidence ?? null;

  if (!quick && !full) {
    return (
      <Text size="xs" c="dimmed">
        No AI reasoning was recorded for this check (it was scored by the older pipeline, or the
        AI service could not be reached).
      </Text>
    );
  }
  return (
    <Card withBorder radius="md" p="sm">
      <Stack gap="md">
        <Group gap="xs">
          <BrainCircuit size={16} />
          <Text size="sm" fw={700}>
            AI reasoning
          </Text>
        </Group>
        {quick && <Block title="Quick check (at the locker)" ev={quick} />}
        {full && <Block title="Full check (re-run for review)" ev={full} />}
      </Stack>
    </Card>
  );
}
