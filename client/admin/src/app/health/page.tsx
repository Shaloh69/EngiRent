"use client";

import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { CheckCircle2, XCircle, Server, Cpu, AlertCircle } from "lucide-react";
import api, { isDemoMode } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { roleColor } from "../theme";

// ── Types ────────────────────────────────────────────────────────────────

interface SystemCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface SystemHealth {
  overall: "ok" | "degraded";
  checks: SystemCheck[];
  checkedAt: string;
}

interface SelfTestComponent {
  component: string;
  ok: boolean;
  error?: string;
}

interface KioskSelfTest {
  overall: "ok" | "degraded";
  components: SelfTestComponent[];
  receivedAt: string;
}

/**
 * Health Check page — the authoritative "is everything actually working"
 * view for the whole system (docs/planning/03-revamp-master.md §3.5's
 * Components Check requirement), not a debug afterthought. Two panels:
 *   1. PC-side software (GET /admin/health) — same checks Start.bat runs at
 *      launch, re-checkable live without shell access to the machine.
 *   2. Per-Pi hardware (POST .../command action=self_test + the existing
 *      SSE stream's kiosk_self_test event) — extends the kiosk telemetry
 *      infrastructure already used by the /kiosk page, rather than a
 *      parallel system.
 * Kept as its own page rather than folded into /kiosk — that page is
 * already large and focused on day-to-day locker operation, not
 * system-health diagnostics.
 */
export default function HealthCheckPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [kioskIds, setKioskIds] = useState<string[]>([]);
  const [selfTests, setSelfTests] = useState<Record<string, KioskSelfTest>>({});
  const [testRunning, setTestRunning] = useState<Record<string, boolean>>({});
  const [kioskOnline, setKioskOnline] = useState<Record<string, boolean>>({});

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const resp = await api.get("/admin/health");
      setHealth(resp.data.data as SystemHealth);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const fetchKiosks = useCallback(async () => {
    try {
      const resp = await api.get("/admin/kiosks");
      const ids = (resp.data.data?.kiosks ?? []).map(
        (k: { id: string }) => k.id,
      );
      setKioskIds(ids.length > 0 ? ids : ["kiosk-1"]);
    } catch {
      setKioskIds(["kiosk-1"]);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchKiosks();
    const interval = setInterval(fetchHealth, 30_000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchKiosks]);

  // ── SSE stream — same pattern as /kiosk, subscribed to the events this
  // page actually needs (kiosk_online/offline, kiosk_self_test) ───────────
  useEffect(() => {
    if (isDemoMode) return;
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("admin_token")
        : null;
    if (!token) return;

    const baseUrl =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";
    let aborted = false;
    const ctrl = new AbortController();

    const connect = async () => {
      while (!aborted) {
        try {
          const res = await fetch(`${baseUrl}/admin/kiosks/events`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal,
          });
          if (!res.body) {
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let eventName = "";

          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of decoder
              .decode(value, { stream: true })
              .split("\n")) {
              if (line.startsWith("event: ")) {
                eventName = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6)) as Record<
                    string,
                    unknown
                  >;
                  const kioskId = String(data.kiosk_id ?? "kiosk-1");

                  if (eventName === "kiosk_online") {
                    setKioskOnline((p) => ({ ...p, [kioskId]: true }));
                  } else if (eventName === "kiosk_offline") {
                    setKioskOnline((p) => ({ ...p, [kioskId]: false }));
                  } else if (eventName === "kiosk_self_test") {
                    setTestRunning((p) => ({ ...p, [kioskId]: false }));
                    setSelfTests((p) => ({
                      ...p,
                      [kioskId]: {
                        overall: data.overall as "ok" | "degraded",
                        components: (data.components ??
                          []) as SelfTestComponent[],
                        receivedAt: new Date().toISOString(),
                      },
                    }));
                  }
                } catch {
                  /* malformed JSON */
                }
              }
            }
          }
        } catch {
          if (aborted) break;
        }
        if (!aborted) await new Promise((r) => setTimeout(r, 3000));
      }
    };

    connect();
    return () => {
      aborted = true;
      ctrl.abort();
    };
  }, []);

  const runSelfTest = async (kioskId: string) => {
    setTestRunning((p) => ({ ...p, [kioskId]: true }));
    try {
      if (!isDemoMode) {
        await api.post(`/admin/kiosks/${kioskId}/command`, {
          action: "self_test",
        });
      } else {
        // Demo mode has no real kiosk to respond — fabricate a result so the
        // panel isn't just a permanent spinner.
        setTimeout(() => {
          setTestRunning((p) => ({ ...p, [kioskId]: false }));
          setSelfTests((p) => ({
            ...p,
            [kioskId]: {
              overall: "ok",
              components: [
                { component: "solenoid_1_main_door", ok: true },
                { component: "actuator_1", ok: true },
                { component: "camera_locker_1", ok: true },
                { component: "camera_face", ok: true },
                { component: "backend_connectivity", ok: true },
              ],
              receivedAt: new Date().toISOString(),
            },
          }));
        }, 1500);
      }
    } catch {
      setTestRunning((p) => ({ ...p, [kioskId]: false }));
    }
  };

  const StatusIcon = ({ ok }: { ok: boolean }) => (
    <ThemeIcon
      size={22}
      radius="xl"
      variant="light"
      color={ok ? roleColor.success : roleColor.critical}
    >
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
    </ThemeIcon>
  );

  return (
    <AdminLayout>
      <Stack gap="lg">
        <PageHeader
          eyebrow="Diagnostics"
          title="Health Check"
          description={
            'PC-side software components and live per-kiosk hardware status — the single source of truth for "is everything actually working."'
          }
          onRefresh={fetchHealth}
          refreshing={healthLoading}
        />

        {/* PC software checks */}
        <Card withBorder radius="md" padding="lg">
          <Group gap="sm" mb="md">
            <ThemeIcon size={38} radius="md" variant="light" color={roleColor.brand}>
              <Server size={19} />
            </ThemeIcon>
            <Text fw={700}>PC Software Components</Text>
            {health && (
              <Badge
                variant="light"
                color={health.overall === "ok" ? roleColor.success : roleColor.warning}
              >
                {health.overall === "ok" ? "All OK" : "Degraded"}
              </Badge>
            )}
          </Group>
          <Divider mb="md" />

          {healthLoading && !health ? (
            <Center mih={140}>
              <Loader size="sm" />
            </Center>
          ) : !health ? (
            <Alert icon={<AlertCircle size={16} />} color={roleColor.critical} variant="light">
              Could not reach the Node API to run the Components Check.
            </Alert>
          ) : (
            <Stack gap="xs">
              {health.checks.map((c) => (
                <Card key={c.name} withBorder radius="sm" padding="sm">
                  <Group gap="sm" align="flex-start" wrap="nowrap">
                    <StatusIcon ok={c.ok} />
                    <div>
                      <Text size="sm" fw={600}>
                        {c.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {c.detail}
                      </Text>
                    </div>
                  </Group>
                </Card>
              ))}
              <Text size="xs" c="dimmed" mt={4}>
                Last checked: {new Date(health.checkedAt).toLocaleTimeString()}
              </Text>
            </Stack>
          )}
        </Card>

        {/* Per-kiosk hardware self-test */}
        {kioskIds.map((kioskId) => {
          const test = selfTests[kioskId];
          const online = kioskOnline[kioskId];
          return (
            <Card key={kioskId} withBorder radius="md" padding="lg">
              <Group justify="space-between" wrap="wrap" mb="md">
                <Group gap="sm">
                  <ThemeIcon size={38} radius="md" variant="light" color={roleColor.accent}>
                    <Cpu size={19} />
                  </ThemeIcon>
                  <Text fw={700}>Kiosk: {kioskId}</Text>
                  {online !== undefined && (
                    <Badge
                      variant="light"
                      color={online ? roleColor.success : "gray"}
                    >
                      {online ? "Online" : "Offline"}
                    </Badge>
                  )}
                  {test && (
                    <Badge
                      variant="light"
                      color={test.overall === "ok" ? roleColor.success : roleColor.warning}
                    >
                      {test.overall === "ok" ? "Hardware OK" : "Hardware Degraded"}
                    </Badge>
                  )}
                </Group>
                <Button
                  variant="light"
                  loading={testRunning[kioskId]}
                  onClick={() => runSelfTest(kioskId)}
                >
                  Run Self-Test
                </Button>
              </Group>
              <Divider mb="md" />

              {!test ? (
                <Text size="sm" c="dimmed">
                  No self-test has been run yet this session. Press &quot;Run
                  Self-Test&quot; to pulse every solenoid/actuator and check every
                  camera remotely.
                </Text>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
                  {test.components.map((c) => (
                    <Card key={c.component} withBorder radius="sm" padding="sm">
                      <Group gap="sm" align="flex-start" wrap="nowrap">
                        <StatusIcon ok={c.ok} />
                        <div>
                          <Text size="xs" fw={600} ff="monospace">
                            {c.component}
                          </Text>
                          {c.error && (
                            <Text size="xs" c={roleColor.critical}>
                              {c.error}
                            </Text>
                          )}
                        </div>
                      </Group>
                    </Card>
                  ))}
                </SimpleGrid>
              )}
            </Card>
          );
        })}
      </Stack>
    </AdminLayout>
  );
}
