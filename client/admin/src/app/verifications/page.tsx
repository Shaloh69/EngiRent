"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Modal,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Images,
  ScanFace,
  ThumbsDown,
  ThumbsUp,
  TimerReset,
} from "lucide-react";
import api from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTableCard } from "@/components/ui/DataTableCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { roleColor } from "../theme";
import { StatValue } from "@/components/ui/UnknownValue";

/**
 * A Verification hangs off ONE of two relations, never both:
 *   `rental`        — a RETURN verification  (Rental.verificationId)
 *   `depositRental` — a DEPOSIT verification (Rental.depositVerificationId)
 *
 * This page only ever read `v.rental`, so every deposit row rendered its item
 * as an em dash and was unsearchable by name — which is most of the queue,
 * because deposits outnumber returns and the fast tier sends far more of them
 * to review. Found on screen 2026-09-18 with a real deposit in the queue.
 */
function itemTitleOf(v: any): string | null {
  return v?.rental?.item?.title ?? v?.depositRental?.item?.title ?? null;
}

function rentalIdOf(v: any): string | null {
  return v?.rentalId ?? v?.rental?.id ?? v?.depositRental?.id ?? null;
}

/** Which side of the hand-off this verification belongs to. */
function stageOf(v: any): "Deposit" | "Return" | null {
  if (v?.depositRental) return "Deposit";
  if (v?.rental) return "Return";
  return null;
}

/**
 * D-90 — found live 2026-09-22: an admin approved a deposit and the row kept
 * showing "Pending" no matter what, so they clicked Approve three more times
 * in under 30 seconds trying to make it register.
 *
 * `Verification` carries TWO different fields and every badge in this page was
 * reading the wrong one:
 *   `decision` — the ML's own verdict (APPROVED/PENDING/RETRY/REJECTED).
 *                IMMUTABLE. Approving a row never changes it — it is the
 *                historical record of what the model said, on purpose.
 *   `status`   — PENDING/MANUAL_REVIEW/APPROVED/REJECTED/…, and THIS is the
 *                field an admin's approve/reject click actually writes
 *                (adminController's PATCH /admin/verifications/:id).
 *
 * So a row the ML scored PENDING and a human then approved shows `decision:
 * "PENDING"` forever — correctly, that IS what the model said — but every
 * badge, the stat tiles, and the filter dropdown all displayed `decision`
 * alone, so an approved row looked identical to an untouched one everywhere
 * in the UI. This is the single place that reconciles the two: once a human
 * (or the background full run) has actually decided, THAT wins.
 */
function effectiveDecision(v: any): string {
  if (v?.status === "APPROVED" || v?.status === "REJECTED") return v.status;
  return v?.decision;
}

/** True once a row has an actual, final human/auto decision recorded against
 *  it — as opposed to still sitting in MANUAL_REVIEW waiting for one. */
function isDecided(v: any): boolean {
  return v?.status === "APPROVED" || v?.status === "REJECTED";
}

export default function VerificationsPage() {
  const [verifications, setVerifications] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The row currently open in the comparison view. Holding the whole row, not
  // just an id, keeps the modal rendering the data the reviewer was looking at
  // when they clicked, even if the list refreshes underneath them.
  const [reviewing, setReviewing] = useState<any | null>(null);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    void fetchVerifications();
  }, []);

  const fetchVerifications = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/verifications");
      setVerifications(response.data.data?.verifications || []);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to fetch verifications.");
      setVerifications([]);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/admin/verifications/${id}`, { status });
      await fetchVerifications();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to update verification.");
    }
  };

  /**
   * Decide from inside the comparison view. Kept separate from updateStatus so
   * the modal only closes on success — a failed decision that closed the modal
   * anyway would read as "done" and the reviewer would move on, leaving a
   * student's item in limbo.
   */
  const decide = async (id: string, status: string) => {
    setDeciding(true);
    try {
      await api.patch(`/admin/verifications/${id}`, { status });
      setReviewing(null);
      await fetchVerifications();
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to update verification.");
    } finally {
      setDeciding(false);
    }
  };

  const filtered = useMemo(
    () =>
      verifications.filter((v) => {
        const term = search.toLowerCase();
        const title = itemTitleOf(v) ?? "";
        const matchesSearch = !term || title.toLowerCase().includes(term);
        const matchesDecision = !decision || effectiveDecision(v) === decision;
        return matchesSearch && matchesDecision;
      }),
    [verifications, search, decision],
  );

  const stats = useMemo(() => {
    const scores = verifications
      .map((v) => Number(v.confidenceScore ?? 0))
      .filter((n) => !Number.isNaN(n));
    const avg = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
    return {
      total: verifications.length,
      approved: verifications.filter((v) => effectiveDecision(v) === "APPROVED").length,
      // "Needs review" means exactly that: nobody has decided yet. A row an
      // admin already approved or rejected is resolved, however low the ML
      // scored it — counting it here is what made this tile perpetually
      // overstate the queue.
      needsReview: verifications.filter((v) => !isDecided(v)).length,
      avg,
    };
  }, [verifications]);

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="AI Checks"
          title="Verifications"
          description="Deposit and return image checks with the model's confidence score for each decision."
          onRefresh={fetchVerifications}
          refreshing={loading}
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {[
            { label: "Total Checks", value: stats.total, icon: ScanFace, color: roleColor.brand },
            { label: "Approved", value: stats.approved, icon: CheckCircle2, color: roleColor.success },
            { label: "Needs Review", value: stats.needsReview, icon: TimerReset, color: roleColor.warning },
            { label: "Avg Confidence", value: `${stats.avg.toFixed(1)}%`, icon: Camera, color: roleColor.accent },
          ].map((s) => (
            <Card key={s.label} withBorder radius="md" padding="lg">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                    {s.label}
                  </Text>
                  <Text size="xl" fw={800} mt={4}>
                    {/* D-38: these read 0 (or P0) directly under the page's
                        own error banner. A count derived from a response we
                        never received is not zero, it is unknown. */}
                    <StatValue
                      value={error ? null : s.value}
                      label={`${s.label} unavailable`}
                    />
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
          columns={["Item", "Decision", "Confidence", "Checked", "Actions"]}
          loading={loading}
          isEmpty={filtered.length === 0}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search by item…",
          }}
          filters={[
            {
              value: decision,
              onChange: setDecision,
              placeholder: "Decision",
              data: [
                { value: "APPROVED", label: "Approved" },
                { value: "PENDING", label: "Pending" },
                { value: "RETRY", label: "Retry" },
                { value: "REJECTED", label: "Rejected" },
              ],
            },
          ]}
          emptyState={
            <EmptyState
              icon={ScanFace}
              title={
                error
                  ? "Could not load verification checks"
                  : verifications.length === 0
                    ? "No verifications yet"
                    : "No matching checks"
              }
              description={
                /* D-38: on THIS page the false claim is the most costly one in
                   the console. "No verifications yet" reads as "the AI pipeline
                   has produced nothing", which is a hardware/ML story. It is
                   not -- it is a failed HTTP request. */
                error
                  ? "The request failed, so this is not a count of zero."
                  : verifications.length === 0
                    ? "AI checks appear here as items are deposited and returned at the kiosk."
                    : "Try clearing the search or filters."
              }
            />
          }
        >
          {filtered.map((v) => {
            const score = Number(v.confidenceScore ?? 0);
            const rentalId = rentalIdOf(v);
            const title = itemTitleOf(v);
            const stage = stageOf(v);
            return (
              <Table.Tr key={v.id}>
                <Table.Td>
                  <Stack gap={2}>
                    {rentalId ? (
                      <Anchor component={Link} href={`/rentals/${rentalId}`} fw={600} size="sm">
                        {title ?? "View rental"}
                      </Anchor>
                    ) : (
                      <Text size="sm" fw={600}>
                        {title ?? "—"}
                      </Text>
                    )}
                    {stage && (
                      <Text size="xs" c="dimmed">
                        {stage}
                      </Text>
                    )}
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={effectiveDecision(v)} />
                </Table.Td>
                <Table.Td>
                  <Stack gap={2} w={160}>
                    {/*
                      The number above is the FAST verdict — the check a student
                      waited on at the locker, which skips stages to finish in
                      time. A 0.0% here usually means it produced no evidence at
                      all (the ML service timed out or was unreachable), NOT
                      that the item scored zero. Showing it alone made a review
                      queue of 0.0% rows that a reviewer could not act on.
                    */}
                    <Text size="xs" fw={600}>
                      {v.unavailable ? "no evidence" : `${score.toFixed(1)}%`}
                    </Text>
                    {!v.unavailable && (
                      <Progress
                        value={score}
                        size="xs"
                        color={
                          score >= 85
                            ? roleColor.success
                            : score >= 60
                              ? roleColor.warning
                              : roleColor.critical
                        }
                      />
                    )}
                    {v.unavailable && v.unavailableReason && (
                      <Text size="xs" c="dimmed">
                        {v.unavailableReason}
                      </Text>
                    )}
                    {/* The full model's second opinion — every stage, no time
                        pressure. This is the number a human should weigh. */}
                    {v.deepReviewStatus && (
                      <Text size="xs" c="dimmed" mt={4}>
                        {v.deepReviewStatus === "COMPLETED"
                          ? `full model: ${Number(v.deepReviewScore ?? 0).toFixed(1)}% ${v.deepReviewDecision ?? ""}`
                          : v.deepReviewStatus === "FAILED"
                            ? "full model: failed"
                            : `full model: ${v.deepReviewStatus.toLowerCase()}…`}
                      </Text>
                    )}
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{new Date(v.createdAt).toLocaleString()}</Text>
                </Table.Td>
                <Table.Td>
                  {/*
                    The approve/reject icons used to live HERE, in the row, with
                    no way to see the photographs at all — a reviewer was asked
                    to decide whether two items matched while looking only at a
                    percentage. Since the deposit decision releases someone
                    else's property, that is the one decision in this product
                    that must not be takeable blind, so it now lives behind the
                    comparison view and cannot be reached without opening it.
                  */}
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<Images size={14} />}
                    onClick={() => setReviewing(v)}
                  >
                    Review
                  </Button>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </DataTableCard>
      </Stack>

      {/*
        THE COMPARISON VIEW.
        Listing photos on the left, what the locker camera actually saw on the
        right. The whole judgement is "are these the same object", and until
        now the queue never showed either side of it.

        The image URLs arrive already signed: mediaUrlRewriter turns any
        `verifications/**` path into a short-lived signed URL on the way out
        (1h TTL, MEDIA_SIGNED_URL_TTL_SECONDS), because kiosk captures are
        evidence tied to a specific rental and are deliberately not publicly
        readable. So a page left open for hours may show broken images —
        reload it rather than assuming the capture is missing.
      */}
      <Modal
        opened={reviewing !== null}
        onClose={() => setReviewing(null)}
        title={
          reviewing
            ? `${stageOf(reviewing) ?? "Check"} — ${itemTitleOf(reviewing) ?? "unknown item"}`
            : ""
        }
        size="xl"
      >
        {reviewing && (
          <Stack gap="md">
            <Group gap="xs">
              <StatusBadge status={effectiveDecision(reviewing)} />
              <Text size="sm" c="dimmed">
                {reviewing.unavailable
                  ? `quick check produced no evidence (${reviewing.unavailableReason ?? "unknown"})`
                  : `quick check: ${Number(reviewing.confidenceScore ?? 0).toFixed(1)}%`}
              </Text>
              {reviewing.deepReviewStatus === "COMPLETED" && (
                <Text size="sm" c="dimmed">
                  · full model: {Number(reviewing.deepReviewScore ?? 0).toFixed(1)}%{" "}
                  {reviewing.deepReviewDecision ?? ""}
                </Text>
              )}
            </Group>

            {/* D-90: once a human (or the background full run) has actually
                decided this row, say so plainly and take the action buttons
                away — a click here after that point cannot help, and REJECT
                specifically can actively corrupt state: the server only
                releases/cancels while the rental is still DEPOSITED, so a
                stale reject on an already-approved-and-claimed rental would
                flip this row's own status to REJECTED while the rental itself
                carries on ACTIVE, a contradiction nobody would think to check
                for later. */}
            {isDecided(reviewing) && (
              <Alert color={roleColor.success} variant="light" icon={<CheckCircle2 size={16} />}>
                Already {reviewing.status === "APPROVED" ? "approved" : "rejected"} — no further
                action needed here.
              </Alert>
            )}

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  Listing photos (what was promised)
                </Text>
                <ImageStrip urls={asUrlList(reviewing.originalImages)} />
              </Stack>
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  Locker camera (what was placed)
                </Text>
                <ImageStrip urls={asUrlList(reviewing.kioskImages)} />
              </Stack>
            </SimpleGrid>

            {!isDecided(reviewing) && (
              <Alert color={roleColor.warning} variant="light" icon={<AlertCircle size={16} />}>
                Approving releases the owner&apos;s item to the renter. Rejecting
                cancels the rental and returns the item to its owner. Both are
                hard to undo — look at the photographs first.
              </Alert>
            )}

            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setReviewing(null)}>
                {isDecided(reviewing) ? "Close" : "Cancel"}
              </Button>
              {!isDecided(reviewing) && (
                <>
                  <Button
                    color={roleColor.critical}
                    leftSection={<ThumbsDown size={15} />}
                    loading={deciding}
                    onClick={() => decide(reviewing.id, "REJECTED")}
                  >
                    Doesn&apos;t match — reject
                  </Button>
                  <Button
                    color={roleColor.success}
                    leftSection={<ThumbsUp size={15} />}
                    loading={deciding}
                    onClick={() => decide(reviewing.id, "APPROVED")}
                  >
                    Same item — approve
                  </Button>
                </>
              )}
            </Group>
          </Stack>
        )}
      </Modal>
    </AdminLayout>
  );
}

/**
 * `originalImages` / `kioskImages` are Json columns holding a string array.
 * Tolerates the shapes actually seen in this database rather than trusting the
 * type: a real array, a JSON-encoded string from an older write path, or null.
 * A reviewer seeing "no images" must mean it, not mean "we could not parse it".
 */
function asUrlList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((u): u is string => typeof u === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((u): u is string => typeof u === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function ImageStrip({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No images on this record.
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      {urls.map((url, i) => (
        // Plain <img> on purpose: next/image would need the rotating
        // Cloudflare tunnel hostname in next.config's remotePatterns, and that
        // hostname changes on every restart.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${url}-${i}`}
          src={url}
          alt={`comparison image ${i + 1}`}
          style={{
            width: "100%",
            borderRadius: 8,
            display: "block",
            objectFit: "contain",
            maxHeight: 320,
            background: "rgba(0,0,0,0.2)",
          }}
        />
      ))}
    </Stack>
  );
}
