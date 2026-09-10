"use client";

import { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  AlertCircle,
  Clock,
  FileCode2,
  Info,
  Save,
  Tag,
  Wallet,
} from "lucide-react";
import api from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { roleColor } from "../theme";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

// Mirrors LATE_FEE_RATE_BY_CATEGORY / DEFAULT_LATE_FEE_RATE_PER_DAY in
// server/node_server/src/index.ts. These are compile-time constants on the
// server with no read or write endpoint, so they're shown here as a
// reference rather than as an editable form — a save button that silently
// did nothing would be worse than being explicit about where they live.
const LATE_FEE_RATES: { category: string; label: string; rate: number; note: string }[] = [
  { category: "SCHOOL_ATTIRE", label: "School Attire", rate: 12, note: "avg of lab gown / uniforms" },
  { category: "ACADEMIC_TOOLS", label: "Academic Tools", rate: 15, note: "avg of calculator / drawing tools" },
  { category: "ELECTRONICS", label: "Electronics", rate: 28, note: "avg of laptop / tablet / power bank" },
  { category: "DEVELOPMENT_KITS", label: "Dev Kits", rate: 20, note: "avg of Arduino / Raspberry Pi kits" },
  { category: "MEASUREMENT_TOOLS", label: "Measurement", rate: 10, note: "multimeter" },
  { category: "AUDIO_VISUAL", label: "Audio/Visual", rate: 45, note: "avg of headphones / camera" },
  { category: "SPORTS_EQUIPMENT", label: "Sports", rate: 50, note: "fallback — no documented rate" },
  { category: "OTHER", label: "Other", rate: 50, note: "fallback — no documented rate" },
];

interface KioskConfig {
  lockers?: Record<
    string,
    {
      main_door_open_seconds?: number;
      bottom_door_open_seconds?: number;
      actuator_extend_seconds?: number;
      actuator_retract_seconds?: number;
    }
  >;
  face_recognition?: {
    confidence_threshold?: number;
    capture_attempts?: number;
    capture_timeout_seconds?: number;
  };
}

export default function SettingsPage() {
  const [kiosks, setKiosks] = useState<{ value: string; label: string }[]>([]);
  const [kioskId, setKioskId] = useState<string | null>(null);
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchKiosks();
  }, []);

  useEffect(() => {
    if (kioskId) void fetchConfig(kioskId);
  }, [kioskId]);

  const fetchKiosks = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/kiosks");
      const list = res.data.data?.kiosks || [];
      const options = list.map((k: any) => ({
        value: k.kioskId ?? k.id,
        label: k.kioskId ?? k.id,
      }));
      setKiosks(options);
      if (options.length > 0 && !kioskId) setKioskId(options[0].value);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to load kiosks.");
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async (id: string) => {
    setError("");
    try {
      const res = await api.get(`/admin/kiosks/${id}/config`);
      setConfig(res.data.data?.config ?? res.data.data ?? null);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to load kiosk config.");
      setConfig(null);
    }
  };

  const saveConfig = async () => {
    if (!kioskId || !config) return;
    setSaving(true);
    setError("");
    try {
      await api.put(`/admin/kiosks/${kioskId}/config`, { config });
      notifications.show({
        title: "Configuration saved",
        message: `Timing config updated for ${kioskId}.`,
        color: roleColor.success,
      });
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to save kiosk config.");
    } finally {
      setSaving(false);
    }
  };

  const updateFace = (key: string, value: number) =>
    setConfig((c) => ({
      ...c,
      face_recognition: { ...(c?.face_recognition ?? {}), [key]: value },
    }));

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Configuration"
          title="Settings"
          description="Kiosk timing and verification thresholds, plus the fee rules the platform applies."
          onRefresh={fetchKiosks}
          refreshing={loading}
        />

        {error && (
          <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
            {error}
          </Alert>
        )}

        <Card withBorder radius="md" padding="lg">
          <Group justify="space-between" wrap="wrap" mb="md">
            <Group gap="sm">
              <ThemeIcon size={38} radius="md" variant="light" color={roleColor.brand}>
                <Clock size={19} />
              </ThemeIcon>
              <div>
                <Title order={3} size="h5">
                  Kiosk Verification &amp; Timing
                </Title>
                <Text size="xs" c="dimmed">
                  Applied to the selected kiosk immediately on save.
                </Text>
              </div>
            </Group>
            <Group gap="sm">
              <Select
                placeholder="Select kiosk"
                data={kiosks}
                value={kioskId}
                onChange={setKioskId}
                w={190}
              />
              <Button
                leftSection={<Save size={16} />}
                onClick={saveConfig}
                loading={saving}
                disabled={!config || !kioskId}
              >
                Save changes
              </Button>
            </Group>
          </Group>

          {!config ? (
            <Alert icon={<Info size={16} />} color={roleColor.warning} variant="light">
              {/* D-38: "no kiosks are registered" is a claim about hardware.
                  If the request failed we know nothing about the hardware --
                  and on this page that distinction matters more than most,
                  because "no kiosks registered" reads as a deployment problem
                  rather than a network one. */}
              {error
                ? "Could not load kiosks. This is not the same as none being registered."
                : kiosks.length === 0
                  ? "No kiosks are registered yet — configuration appears once a kiosk connects."
                  : "Select a kiosk to view its configuration."}
            </Alert>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <NumberInput
                label="Face match threshold"
                description="Minimum confidence to accept a face"
                suffix=""
                min={0}
                max={1}
                step={0.05}
                decimalScale={2}
                value={config.face_recognition?.confidence_threshold ?? 0.6}
                onChange={(v) => updateFace("confidence_threshold", Number(v))}
              />
              <NumberInput
                label="Capture attempts"
                description="Retries before failing verification"
                min={1}
                max={10}
                value={config.face_recognition?.capture_attempts ?? 3}
                onChange={(v) => updateFace("capture_attempts", Number(v))}
              />
              <NumberInput
                label="Capture timeout"
                description="Seconds before the attempt expires"
                min={5}
                max={120}
                value={config.face_recognition?.capture_timeout_seconds ?? 30}
                onChange={(v) => updateFace("capture_timeout_seconds", Number(v))}
              />
            </SimpleGrid>
          )}
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Group gap="sm" mb="md">
            <ThemeIcon size={38} radius="md" variant="light" color={roleColor.accent}>
              <Wallet size={19} />
            </ThemeIcon>
            <div>
              <Title order={3} size="h5">
                Late Fee Rates
              </Title>
              <Text size="xs" c="dimmed">
                Charged per day against the held security deposit.
              </Text>
            </div>
          </Group>

          <Alert
            icon={<FileCode2 size={16} />}
            color={roleColor.warning}
            variant="light"
            mb="md"
          >
            These rates are defined in server code
            (<Text span ff="monospace" size="xs">server/node_server/src/index.ts</Text>) and
            have no configuration endpoint, so they&apos;re shown here as a reference rather
            than an editable form. Changing them requires a code change and redeploy.
          </Alert>

          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th>Rate / day</Table.Th>
                <Table.Th>Basis</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {LATE_FEE_RATES.map((r) => (
                <Table.Tr key={r.category}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {r.label}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={roleColor.accent}>
                      {peso.format(r.rate)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {r.note}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Group gap="sm" mb="md">
            <ThemeIcon size={38} radius="md" variant="light" color={roleColor.cta}>
              <Tag size={19} />
            </ThemeIcon>
            <div>
              <Title order={3} size="h5">
                Item Categories
              </Title>
              <Text size="xs" c="dimmed">
                Fixed set defined by the database schema.
              </Text>
            </div>
          </Group>
          <Divider mb="md" />
          <Group gap="xs">
            {LATE_FEE_RATES.map((c) => (
              <Badge key={c.category} variant="light" color={roleColor.brand} size="lg">
                {c.label}
              </Badge>
            ))}
          </Group>
        </Card>
      </Stack>
    </AdminLayout>
  );
}
