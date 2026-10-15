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
 * Face re-enrolment review (face liveness revamp, ruling 2026-10-15).
 *
 * A student who updates their face must match the face already on the account
 * to replace it at once. When the new face does NOT match (or the account had
 * none), the student re-enters their password and the new face lands here.
 * Until an admin approves it, that student cannot pass a kiosk face step.
 *
 * Same layout as the student-ID queue: the evidence side by side (the face on
 * the account, the new face, the student ID for a third comparison), the
 * decision directly beneath. All three images are short-lived signed links.
 */

interface Review {
  userId: string;
  name: string;
  email: string;
  studentId: string;
  submittedAt: string;
  reason: "NO_MATCH" | "NO_TEMPLATE" | string;
  distance: number | null;
  currentFaceUrl: string | null;
  newFaceUrl: string | null;
  idPhotoUrl: string | null;
}

const REASON_TEXT: Record<string, string> = {
  NO_MATCH: "The new face did not match the face on the account.",
  NO_TEMPLATE: "The account had no face on file to compare with.",
};

export default function FaceReviewsPage() {
  const [rows, setRows] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rejecting, setRejecting] = useState<Review | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await api.get("/admin/face-reviews");
      setRows(res.data?.data?.reviews ?? []);
    } catch {
      setError("Could not load the face review queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The server tells the admin room when a student sends a face for review.
  useAdminRefetch(["admin:face_review"], () => void load(true));

  const decide = async (row: Review, decision: "APPROVE" | "REJECT") => {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/admin/face-reviews/${row.userId}`, {
        decision,
        note: decision === "REJECT" ? note.trim() || undefined : undefined,
      });
      setRejecting(null);
      setNote("");
      await load(true);
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
        title="Face updates"
        description="New faces that did not match the account's old one. Approve only if the new face is clearly the same student; the ID photo is there for a third comparison."
      />

      <Stack gap="md">
        {error && (
          <Alert color="red" icon={<AlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Text c="dimmed" size="sm">
            Loading…
          </Text>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScanFace}
            title="Nothing waiting"
            description="Every face update has been reviewed."
          />
        ) : (
          <Stack gap="lg">
            {rows.map((row) => (
              <Card key={row.userId} withBorder padding="lg">
                <Group justify="space-between" mb="md" wrap="nowrap">
                  <div>
                    <Title order={4}>{row.name}</Title>
                    <Text size="sm" c="dimmed">
                      {row.email} · Student no. {row.studentId} · sent{" "}
                      {new Date(row.submittedAt).toLocaleString()}
                    </Text>
                  </div>
                  <Badge color={row.reason === "NO_MATCH" ? "orange" : "gray"}>
                    {row.reason === "NO_MATCH" ? "Does not match" : "No face on file"}
                  </Badge>
                </Group>

                <Text size="sm" mb="sm">
                  {REASON_TEXT[row.reason] ?? row.reason}
                  {row.distance != null && (
                    <Text span c="dimmed">
                      {" "}
                      (difference {row.distance.toFixed(2)}; under 0.50 counts as
                      the same person)
                    </Text>
                  )}
                </Text>

                <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
                  <Pane
                    label="Face on the account"
                    icon={<ScanFace size={15} />}
                    url={row.currentFaceUrl}
                    empty="No face on file."
                  />
                  <Pane
                    label="New face"
                    icon={<ScanFace size={15} />}
                    url={row.newFaceUrl}
                    empty="The new photo is missing."
                  />
                  <Pane
                    label="Student ID"
                    icon={<IdCard size={15} />}
                    url={row.idPhotoUrl}
                    empty="No ID photo."
                  />
                </SimpleGrid>

                <Group mt="md">
                  <Button
                    leftSection={<BadgeCheck size={16} />}
                    loading={saving}
                    onClick={() => void decide(row, "APPROVE")}
                  >
                    Approve new face
                  </Button>
                  <Button
                    variant="light"
                    color="red"
                    leftSection={<XCircle size={16} />}
                    onClick={() => {
                      setRejecting(row);
                      setNote("");
                    }}
                  >
                    Reject…
                  </Button>
                </Group>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>

      <Modal
        opened={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject this new face"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            The student keeps the face they had, is told this was not approved,
            and can try again from the home screen.
          </Text>
          <Textarea
            label="Note to the student (optional)"
            placeholder="For example: the photo was too dark to compare."
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            maxLength={500}
            autosize
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={saving}
              onClick={() => rejecting && void decide(rejecting, "REJECT")}
            >
              Reject and notify
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AdminLayout>
  );
}

function Pane({
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
        <a href={url} target="_blank" rel="noreferrer">
          <Image src={url} alt={label} h={240} fit="contain" radius="sm" />
        </a>
      ) : (
        <Text size="sm" c="dimmed" py="xl" ta="center">
          {empty}
        </Text>
      )}
    </Card>
  );
}
