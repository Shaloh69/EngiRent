"use client";

import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Spinner,
} from "@heroui/react";
import { CheckCircle2, XCircle, RefreshCw, Server, Cpu } from "lucide-react";
import api, { isDemoMode } from "@/lib/api";

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

  const StatusIcon = ({ ok }: { ok: boolean }) =>
    ok ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
    );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Health Check</h1>
            <p className="text-sm text-default-500">
              PC-side software components and live per-kiosk hardware status —
              the single source of truth for &quot;is everything actually
              working.&quot;
            </p>
          </div>
          <Button
            size="sm"
            variant="flat"
            startContent={<RefreshCw className="h-4 w-4" />}
            onPress={fetchHealth}
            isLoading={healthLoading}
          >
            Refresh
          </Button>
        </div>

        {/* PC software checks */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <span className="font-semibold">PC Software Components</span>
            {health && (
              <Chip
                size="sm"
                color={health.overall === "ok" ? "success" : "warning"}
                variant="flat"
              >
                {health.overall === "ok" ? "All OK" : "Degraded"}
              </Chip>
            )}
          </CardHeader>
          <Divider />
          <CardBody>
            {healthLoading && !health ? (
              <div className="flex justify-center py-8">
                <Spinner size="sm" />
              </div>
            ) : !health ? (
              <p className="text-sm text-danger">
                Could not reach the Node API to run the Components Check.
              </p>
            ) : (
              <div className="space-y-2">
                {health.checks.map((c) => (
                  <div
                    key={c.name}
                    className="flex items-start gap-2 rounded-lg border border-default-200 p-3"
                  >
                    <StatusIcon ok={c.ok} />
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-default-500">{c.detail}</div>
                    </div>
                  </div>
                ))}
                <p className="pt-1 text-xs text-default-400">
                  Last checked:{" "}
                  {new Date(health.checkedAt).toLocaleTimeString()}
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Per-kiosk hardware self-test */}
        {kioskIds.map((kioskId) => {
          const test = selfTests[kioskId];
          const online = kioskOnline[kioskId];
          return (
            <Card key={kioskId}>
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  <span className="font-semibold">Kiosk: {kioskId}</span>
                  {online !== undefined && (
                    <Chip
                      size="sm"
                      color={online ? "success" : "default"}
                      variant="flat"
                    >
                      {online ? "Online" : "Offline"}
                    </Chip>
                  )}
                  {test && (
                    <Chip
                      size="sm"
                      color={test.overall === "ok" ? "success" : "warning"}
                      variant="flat"
                    >
                      {test.overall === "ok"
                        ? "Hardware OK"
                        : "Hardware Degraded"}
                    </Chip>
                  )}
                </div>
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  isLoading={testRunning[kioskId]}
                  onPress={() => runSelfTest(kioskId)}
                >
                  Run Self-Test
                </Button>
              </CardHeader>
              <Divider />
              <CardBody>
                {!test ? (
                  <p className="text-sm text-default-500">
                    No self-test has been run yet this session. Press &quot;Run
                    Self-Test&quot; to pulse every solenoid/actuator and check
                    every camera remotely.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {test.components.map((c) => (
                      <div
                        key={c.component}
                        className="flex items-start gap-2 rounded-lg border border-default-200 p-2"
                      >
                        <StatusIcon ok={c.ok} />
                        <div>
                          <div className="text-xs font-medium">
                            {c.component}
                          </div>
                          {c.error && (
                            <div className="text-xs text-danger">{c.error}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </AdminLayout>
  );
}
