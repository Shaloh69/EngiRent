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
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { AlertCircle, BadgeCheck, IdCard, ScanFace, XCircle } from "lucide-react";
import api from "@/lib/api";
import { useAdminRefetch } from "@/lib/useAdminSocket";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Student ID verification queue.
 *
 * This is the screen that did not exist. `isVerified` was only ever set by an
 * admin flipping the flag on the users table — no queue, no decision record,
 * and crucially no way to see the submitted ID at all, because the photo is
 * served only through a signed URL and nothing minted one (mandate §2.11).
 *
 * Layout follows the standard identity-review pattern: the evidence and the
 * claim side by side, with the decision immediately beneath, so the reviewer
 * never has to hold anything in their head or navigate away mid-decision.
 * Reference: https://ubongabasieka.medium.com/identity-verification-web-application-design-eee5d03a5945
 *
 * Distinct from /verifications, which lists the AI condition checks that
 * compare a rental's deposit and return photos.
 */

interface Row {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  studentId: string;
  phoneNumber: string;
  isVerified: boolean;
  verificationStatus: string;
  verificationReason: string | null;
  verificationNote: string | null;
  verifiedAt: string | null;
  createdAt: string;
  idPhotoUrl: string | null;
  facePhotoUrl: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "yellow",
  APPROVED: "green",
  REJECTED: "red",
  UNSUBMITTED: "gray",
};

export default function IdVerificationsPage() {
  const [status, setStatus] = useState("PENDING");
  const [rows, setRows] = useState<Row[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/admin/id-verifications?status=${status}`);
      setRows(res.data?.data?.verifications ?? []);
      setReasons(res.data?.data?.rejectReasons ?? {});
    } catch {
      setError("Could not load the verification queue.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  // E2.2 / D-4 — this queue used to update only on a manual reload. The
  // refetch is quiet (no loading flash): a socket event should make the list
  // correct, not make the page look like it is starting over while an admin
  // is reading it.
  useAdminRefetch(["admin:verification_submitted"], () => void load(true));

  const decide = async (row: Row, decision: "APPROVE" | "REJECT") => {
    // Rejecting without a reason leaves the student with nothing to act on,
    // so the server refuses it and so does this.
    if (decision === "REJECT" && !reason) {
      setTarget(row);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/admin/id-verifications/${row.id}`, {
        decision,
        reason: decision === "REJECT" ? reason : undefined,
        note: note.trim() || undefined,
      });
      setTarget(null);
      setReason(null);
      setNote("");
      await load();
    } catch {
      setError("The decision could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        eyebrow="Access control"
        title="Student ID verification"
        description="Approve or reject the student IDs submitted at signup. Approving is what lets a student rent and list equipment."
      />

      <Stack gap="md">
        {error && (
          <Alert color="red" icon={<AlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <SegmentedControl
          value={status}
          onChange={setStatus}
          data={[
            { label: "Pending", value: "PENDING" },
            { label: "Approved", value: "APPROVED" },
            { label: "Rejected", value: "REJECTED" },
            { label: "All", value: "ALL" },
          ]}
        />

        {loading ? (
          <Text c="dimmed" size="sm">
            Loading…
          </Text>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title={
              status === "PENDING"
                ? "Nothing waiting"
                : "No records in this filter"
            }
            description={
              status === "PENDING"
                ? "Every submitted student ID has been reviewed."
                : "Try a different filter."
            }
          />
        ) : (
          <Stack gap="lg">
            {rows.map((row) => (
              <Card key={row.id} withBorder padding="lg">
                <Group justify="space-between" mb="md" wrap="nowrap">
                  <div>
                    <Title order={4}>
                      {row.firstName} {row.lastName}
                    </Title>
                    <Text size="sm" c="dimmed">
                      {row.email} · Student no. {row.studentId} ·{" "}
                      {row.phoneNumber}
                    </Text>
                  </div>
                  <Badge color={STATUS_COLOR[row.verificationStatus] ?? "gray"}>
                    {row.verificationStatus}
                  </Badge>
                </Group>

                {/* Evidence beside the claim — the reviewer compares the name
                    on the card with the name on the account, and the face on
                    the card with the registered selfie, without navigating. */}
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  <EvidencePane
                    label="Submitted student ID"
                    icon={<IdCard size={15} />}
                    url={row.idPhotoUrl}
                    empty="No ID photo was uploaded."
                  />
                  <EvidencePane
                    label="Registered face photo"
                    icon={<ScanFace size={15} />}
                    url={row.facePhotoUrl}
                    empty="No face photo was registered."
                  />
                </SimpleGrid>

                {row.verificationStatus === "REJECTED" && (
                  <Alert color="red" mt="md" icon={<XCircle size={15} />}>
                    {reasons[row.verificationReason ?? ""] ??
                      row.verificationReason}
                    {row.verificationNote ? ` — ${row.verificationNote}` : ""}
                  </Alert>
                )}

                {row.verificationStatus === "PENDING" ? (
                  <Group mt="md">
                    <Button
                      leftSection={<BadgeCheck size={16} />}
                      loading={saving}
                      onClick={() => void decide(row, "APPROVE")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="light"
                      color="red"
                      leftSection={<XCircle size={16} />}
                      onClick={() => {
                        setTarget(row);
                        setReason(null);
                        setNote("");
                      }}
                    >
                      Reject…
                    </Button>
                  </Group>
                ) : (
                  <Text size="xs" c="dimmed" mt="md">
                    Decided{" "}
                    {row.verifiedAt
                      ? new Date(row.verifiedAt).toLocaleString()
                      : "—"}
                  </Text>
                )}
              </Card>
            ))}
          </Stack>
        )}
      </Stack>

      {/* Rejection needs a reason: the student is told exactly what to fix and
          gets a re-submit path, instead of being left in limbo. */}
      <Modal
        opened={!!target}
        onClose={() => setTarget(null)}
        title="Reject this student ID"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            The student is notified with this reason and can submit a new
            photo.
          </Text>
          <Select
            label="Reason"
            placeholder="Choose one"
            value={reason}
            onChange={setReason}
            data={Object.entries(reasons).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Textarea
            label="Note to the student (optional)"
            placeholder="Anything specific that would help them get it right next time."
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            maxLength={500}
            autosize
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              disabled={!reason}
              loading={saving}
              onClick={() => target && void decide(target, "REJECT")}
            >
              Reject and notify
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AdminLayout>
  );
}

function EvidencePane({
  label,
  icon,
  url,
  empty,
}: {
  label: string;
  icon: React.ReactNode;
  url: string | null;
  empty: string;
}) {
  return (
    <Card withBorder padding="sm">
      <Group gap={6} mb="xs">
        <ThemeIcon size="sm" variant="light">
          {icon}
        </ThemeIcon>
        <Text size="xs" fw={600} tt="uppercase" c="dimmed">
          {label}
        </Text>
      </Group>
      {url ? (
        // Opens full size in a new tab: a reviewer often needs to zoom into a
        // student number, and an inline thumbnail can't be trusted for that.
        <a href={url} target="_blank" rel="noreferrer">
          <Image src={url} alt={label} h={220} fit="contain" radius="sm" />
        </a>
      ) : (
        <Text size="sm" c="dimmed" py="xl" ta="center">
          {empty}
        </Text>
      )}
    </Card>
  );
}
