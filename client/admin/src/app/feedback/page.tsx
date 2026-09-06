"use client";

import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Image,
  Modal,
  Select,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  Clock,
  Flag,
  Lightbulb,
  MessageSquareWarning,
  MonitorSpeaker,
  Receipt,
  User,
} from "lucide-react";
import api from "@/lib/api";
import { useAdminRefetch } from "@/lib/useAdminSocket";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Feedback triage — checklist Stage 3.3.
 *
 * Before this there was no feedback, support or bug-report endpoint on the
 * server at all, so a student who hit a problem had no route to anyone
 * running the system, and admins had no signal except rentals silently
 * failing (mandate §2.9.3). The submission side alone would still be a
 * write-only hole — this is the read/act half that closes the loop.
 */

interface Row {
  id: string;
  category: string;
  body: string;
  screenshotUrl: string | null;
  appVersion: string;
  device: string | null;
  screen: string | null;
  rentalId: string | null;
  kioskId: string | null;
  itemId: string | null;
  kioskEventSnapshot: Array<{ type: string; ts: number; data: unknown }> | null;
  status: string;
  adminNote: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; email: string; studentId: string };
}

const STATUS_COLOR: Record<string, string> = {
  NEW: "yellow",
  ACKNOWLEDGED: "blue",
  RESOLVED: "green",
};

const CATEGORY_ICON: Record<string, typeof Bug> = {
  BUG: Bug,
  SUGGESTION: Lightbulb,
  KIOSK_PROBLEM: MonitorSpeaker,
  PAYMENT_PROBLEM: Receipt,
  ITEM_REPORT: Flag,
  OTHER: MessageSquareWarning,
};

export default function FeedbackPage() {
  const [status, setStatus] = useState("NEW");
  const [category, setCategory] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [resolveTarget, setResolveTarget] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  // Only meaningful for BUG reports fixed by shipping a new build — the
  // Update Required screen reads this to credit the real reporter by name.
  const [fixedInVersion, setFixedInVersion] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ status, limit: "100" });
      if (category) qs.set("category", category);
      const res = await api.get(`/admin/feedback?${qs.toString()}`);
      setRows(res.data?.data?.feedback ?? []);
      setCategories(res.data?.data?.categories ?? {});
    } catch {
      setError("Could not load the feedback queue.");
    } finally {
      setLoading(false);
    }
  }, [status, category]);

  useEffect(() => {
    void load();
  }, [load]);

  // E2.2 / D-4 — this queue used to update only on a manual reload. The
  // refetch is quiet (no loading flash): a socket event should make the list
  // correct, not make the page look like it is starting over while an admin
  // is reading it.
  useAdminRefetch(["admin:feedback_new"], () => void load(true));

  const acknowledge = async (row: Row) => {
    setSaving(true);
    try {
      await api.patch(`/admin/feedback/${row.id}`, { status: "ACKNOWLEDGED" });
      await load();
    } catch {
      setError("Could not acknowledge the report.");
    } finally {
      setSaving(false);
    }
  };

  const resolve = async () => {
    if (!resolveTarget) return;
    setSaving(true);
    try {
      await api.patch(`/admin/feedback/${resolveTarget.id}`, {
        status: "RESOLVED",
        note: note.trim() || undefined,
        fixedInVersion: fixedInVersion.trim() || undefined,
      });
      setResolveTarget(null);
      setNote("");
      setFixedInVersion("");
      await load();
    } catch {
      setError("Could not resolve the report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        eyebrow="Support"
        title="Feedback"
        description="Bug reports, kiosk problems, payment issues and suggestions filed from the app."
        onRefresh={load}
        refreshing={loading}
      />

      <Stack gap="md" mt="md">
        {error && (
          <Alert color="red" icon={<AlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <Group justify="space-between" wrap="wrap">
          <SegmentedControl
            value={status}
            onChange={setStatus}
            data={[
              { label: "New", value: "NEW" },
              { label: "Being looked at", value: "ACKNOWLEDGED" },
              { label: "Resolved", value: "RESOLVED" },
              { label: "All", value: "ALL" },
            ]}
          />
          <Select
            placeholder="All categories"
            clearable
            value={category}
            onChange={setCategory}
            data={Object.entries(categories).map(([value, label]) => ({ value, label }))}
            w={220}
          />
        </Group>

        {loading ? (
          <Text c="dimmed" size="sm">
            Loading…
          </Text>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={MessageSquareWarning}
            title={status === "NEW" ? "Nothing new" : "No reports in this filter"}
            description={
              status === "NEW"
                ? "Every submitted report has been triaged."
                : "Try a different filter."
            }
          />
        ) : (
          <Stack gap="md">
            {rows.map((row) => {
              const Icon = CATEGORY_ICON[row.category] ?? MessageSquareWarning;
              return (
                <Card key={row.id} withBorder padding="lg">
                  <Group justify="space-between" mb="sm" wrap="nowrap" align="flex-start">
                    <Group gap="sm" wrap="nowrap">
                      <ThemeIcon size="lg" variant="light" color="teal">
                        <Icon size={18} />
                      </ThemeIcon>
                      <div>
                        <Group gap={6}>
                          <Text fw={700} size="sm">
                            {categories[row.category] ?? row.category}
                          </Text>
                          <Badge color={STATUS_COLOR[row.status] ?? "gray"} size="sm">
                            {row.status}
                          </Badge>
                        </Group>
                        <Group gap={4} mt={2}>
                          <User size={12} />
                          <Text size="xs" c="dimmed">
                            {row.user.firstName} {row.user.lastName} · {row.user.email} ·{" "}
                            {new Date(row.createdAt).toLocaleString()}
                          </Text>
                        </Group>
                      </div>
                    </Group>
                  </Group>

                  <Text size="sm" mb="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {row.body}
                  </Text>

                  {/* Automatically attached context — a report is close to
                      useless without knowing what build and what screen. */}
                  <Group gap="xs" mb="sm">
                    <Badge variant="outline" color="gray" size="xs">
                      v{row.appVersion}
                    </Badge>
                    {row.device && (
                      <Badge variant="outline" color="gray" size="xs">
                        {row.device}
                      </Badge>
                    )}
                    {row.screen && (
                      <Badge variant="outline" color="gray" size="xs">
                        {row.screen}
                      </Badge>
                    )}
                    {row.rentalId && (
                      <Badge variant="outline" color="blue" size="xs">
                        Rental {row.rentalId.slice(0, 8)}
                      </Badge>
                    )}
                    {row.kioskId && (
                      <Badge variant="outline" color="grape" size="xs">
                        Kiosk {row.kioskId}
                      </Badge>
                    )}
                    {row.itemId && (
                      <Badge variant="outline" color="orange" size="xs">
                        Listing {row.itemId.slice(0, 8)}
                      </Badge>
                    )}
                  </Group>

                  {row.screenshotUrl && (
                    <a href={row.screenshotUrl} target="_blank" rel="noreferrer">
                      <Image
                        src={row.screenshotUrl}
                        alt="Attached screenshot"
                        h={160}
                        w="auto"
                        fit="contain"
                        radius="sm"
                        mb="sm"
                        style={{ border: "1px solid var(--mantine-color-default-border)" }}
                      />
                    </a>
                  )}

                  {/* Kiosk-problem context: the rolling event log snapshot —
                      "the locker didn't open" is unanswerable without this. */}
                  {row.category === "KIOSK_PROBLEM" &&
                    (row.kioskEventSnapshot?.length ? (
                      <Card withBorder padding="xs" mb="sm" bg="var(--mantine-color-default-hover)">
                        <Group gap={6} mb={4}>
                          <Clock size={13} />
                          <Text size="xs" fw={600}>
                            Kiosk event log at the time of the report
                          </Text>
                        </Group>
                        <Stack gap={2}>
                          {row.kioskEventSnapshot.slice(-8).map((e, i) => (
                            <Text key={i} size="xs" ff="monospace" c="dimmed">
                              {new Date(e.ts).toLocaleTimeString()} — {e.type}
                            </Text>
                          ))}
                        </Stack>
                      </Card>
                    ) : (
                      <Alert color="gray" variant="light" mb="sm" py={6}>
                        <Text size="xs">
                          No recorded events for kiosk {row.kioskId ?? "(none given)"} around this
                          report — it may never have reached the kiosk, or the kiosk was offline.
                        </Text>
                      </Alert>
                    ))}

                  {row.status === "RESOLVED" ? (
                    <Group gap={6}>
                      <CheckCircle2 size={14} color="var(--mantine-color-green-6)" />
                      <Text size="xs" c="dimmed">
                        Resolved {row.resolvedAt ? new Date(row.resolvedAt).toLocaleString() : ""}
                        {row.adminNote ? ` — ${row.adminNote}` : ""}
                      </Text>
                    </Group>
                  ) : (
                    <Group>
                      {row.status === "NEW" && (
                        <Button size="xs" variant="light" loading={saving} onClick={() => void acknowledge(row)}>
                          Acknowledge
                        </Button>
                      )}
                      <Button
                        size="xs"
                        onClick={() => {
                          setResolveTarget(row);
                          setNote("");
                          setFixedInVersion("");
                        }}
                      >
                        Resolve…
                      </Button>
                    </Group>
                  )}
                </Card>
              );
            })}
          </Stack>
        )}
      </Stack>

      {/* Resolving notifies the reporter with this note — otherwise the loop
          only closes on the admin's side of it. */}
      <Modal
        opened={!!resolveTarget}
        onClose={() => setResolveTarget(null)}
        title="Resolve this report"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            The reporter is notified with this note. Leave it blank to send a generic
            acknowledgement.
          </Text>
          <Textarea
            label="Note to the student (optional)"
            placeholder="What was fixed, or what they should try."
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            maxLength={2000}
            autosize
            minRows={3}
          />
          {resolveTarget?.category === "BUG" && (
            <TextInput
              label="Fixed in version (optional)"
              description="If this bug is what prompted a new release, the app's Update Required screen will credit this student by name for it."
              placeholder="e.g. 1.6.1"
              value={fixedInVersion}
              onChange={(e) => setFixedInVersion(e.currentTarget.value)}
              maxLength={32}
            />
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setResolveTarget(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void resolve()}>
              Resolve and notify
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AdminLayout>
  );
}
