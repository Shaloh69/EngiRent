"use client";

import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Spinner,
  Divider,
} from "@heroui/react";
import {
  Activity,
  Lock,
  LockOpen,
  RotateCcw,
  Save,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import api, { isDemoMode } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LockerTiming {
  main_door_open_seconds: number;
  trapdoor_unlock_seconds: number;
  bottom_door_open_seconds: number;
  actuator_push_seconds: number;
  actuator_pull_seconds: number;
  actuator_speed_percent: number;
}

interface KioskState {
  id: string;
  status: "online" | "offline" | "error" | string;
  lastSeen: string | null;
  lockers: Record<string, { main: string; trapdoor: string; bottom: string }>;
  timing: Record<string, LockerTiming>;
}

const DEFAULT_TIMING: LockerTiming = {
  main_door_open_seconds: 15,
  trapdoor_unlock_seconds: 2,
  bottom_door_open_seconds: 15,
  actuator_push_seconds: 5,
  actuator_pull_seconds: 5,
  actuator_speed_percent: 100,
};

const DEMO_STATE: KioskState = {
  id: "kiosk-1",
  status: "online",
  lastSeen: new Date().toISOString(),
  lockers: {
    "1": { main: "locked", trapdoor: "locked", bottom: "locked" },
    "2": { main: "locked", trapdoor: "locked", bottom: "locked" },
    "3": { main: "locked", trapdoor: "locked", bottom: "locked" },
    "4": { main: "locked", trapdoor: "locked", bottom: "locked" },
  },
  timing: {
    "1": { ...DEFAULT_TIMING },
    "2": { ...DEFAULT_TIMING },
    "3": { ...DEFAULT_TIMING },
    "4": { ...DEFAULT_TIMING },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function numInput(
  label: string,
  value: number,
  onChange: (v: number) => void,
  unit: string,
  min = 1,
  max = 60,
) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          size="sm"
          min={min}
          max={max}
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          classNames={{ input: "text-center", base: "w-24" }}
        />
        <span className="text-xs text-[var(--color-muted)]">{unit}</span>
      </div>
    </div>
  );
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function KioskPage() {
  const [kiosk, setKiosk] = useState<KioskState | null>(null);
  const [timing, setTiming] = useState<Record<string, LockerTiming>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [cmdLoading, setCmdLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Initial config fetch (once on mount) ──────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      if (isDemoMode) {
        setKiosk(DEMO_STATE);
        setTiming({ ...DEMO_STATE.timing });
        return;
      }
      const [kioskRes, configRes] = await Promise.allSettled([
        api.get("/admin/kiosks"),
        api.get("/admin/kiosks/kiosk-1/config"),
      ]);
      const kioskId =
        kioskRes.status === "fulfilled"
          ? (kioskRes.value.data.data?.kiosks?.[0]?.id ?? "kiosk-1")
          : "kiosk-1";
      const config =
        configRes.status === "fulfilled"
          ? (configRes.value.data.data?.config ?? {})
          : {};
      setKiosk({
        ...DEMO_STATE,
        id: kioskId,
        timing: config.lockers ?? DEMO_STATE.timing,
      });
      setTiming(config.lockers ?? { ...DEMO_STATE.timing });
    } catch {
      setKiosk(DEMO_STATE);
      setTiming({ ...DEMO_STATE.timing });
    } finally {
      setLoading(false);
    }
  }, []);

  // ── SSE — real-time kiosk events (replaces polling) ───────────────────────
  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (isDemoMode) return;
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("admin_token")
        : null;
    if (!token) return;

    const baseUrl =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";
    const controller = new AbortController();

    fetch(`${baseUrl}/admin/kiosks/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let eventName = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6)) as Record<
                  string,
                  unknown
                >;
                if (eventName === "kiosk_online") {
                  setKiosk((prev) =>
                    prev ? { ...prev, status: "online", lastSeen: new Date().toISOString() } : prev,
                  );
                } else if (eventName === "kiosk_status") {
                  const lockers = data.lockers as
                    | KioskState["lockers"]
                    | undefined;
                  setKiosk((prev) =>
                    prev
                      ? {
                          ...prev,
                          status: "online",
                          lastSeen: new Date().toISOString(),
                          ...(lockers ? { lockers } : {}),
                        }
                      : prev,
                  );
                } else if (eventName === "kiosk_error") {
                  setKiosk((prev) =>
                    prev ? { ...prev, status: "error" } : prev,
                  );
                }
              } catch {
                // malformed JSON — ignore
              }
            }
          }
        }
      })
      .catch(() => {
        // connection closed or aborted — silently ignore
      });

    return () => controller.abort();
  }, []);

  const updateTiming = (
    lockerId: string,
    field: keyof LockerTiming,
    value: number,
  ) => {
    setTiming((prev) => ({
      ...prev,
      [lockerId]: { ...prev[lockerId], [field]: value },
    }));
  };

  const saveTiming = async (lockerId: string) => {
    setSaving((p) => ({ ...p, [lockerId]: true }));
    try {
      if (!isDemoMode) {
        await api.put(`/admin/kiosks/${kiosk?.id ?? "kiosk-1"}/config`, {
          config: { lockers: { ...timing, [lockerId]: timing[lockerId] } },
        });
      }
      showToast(`Locker ${lockerId} timing saved`);
    } catch {
      showToast(`Failed to save locker ${lockerId} timing`, false);
    } finally {
      setSaving((p) => ({ ...p, [lockerId]: false }));
    }
  };

  const sendCommand = async (
    cmd: string,
    payload: Record<string, unknown> = {},
  ) => {
    const key = `${cmd}-${JSON.stringify(payload)}`;
    setCmdLoading(key);
    try {
      if (!isDemoMode) {
        await api.post(`/admin/kiosks/${kiosk?.id ?? "kiosk-1"}/command`, {
          action: cmd,
          ...payload,
        });
      }
      showToast(`Command "${cmd}" sent`);
    } catch {
      showToast(`Command "${cmd}" failed`, false);
    } finally {
      setCmdLoading(null);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </AdminLayout>
    );
  }

  const isOnline = kiosk?.status === "online";

  return (
    <AdminLayout>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-semibold shadow-lg transition ${
            toast.ok
              ? "bg-green-500/20 text-green-400 border border-green-500"
              : "bg-red-500/20 text-red-400 border border-red-500"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--color-ink)]">
              Kiosk Control
            </h1>
            <p className="text-sm text-[var(--color-muted)]">
              Manage lockers, timing and commands
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip
              size="sm"
              startContent={
                isOnline ? <Wifi size={13} /> : <WifiOff size={13} />
              }
              className={
                isOnline
                  ? "border border-green-500 bg-green-500/10 text-green-400"
                  : "border border-red-500 bg-red-500/10 text-red-400"
              }
            >
              {isOnline ? "Online" : "Offline"}
            </Chip>
            <Button
              size="sm"
              variant="flat"
              startContent={<RefreshCw size={14} />}
              onPress={fetchState}
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Global commands */}
        <Card className="border border-[var(--color-border)] bg-[var(--color-surface)]">
          <CardHeader className="pb-2 font-semibold text-[var(--color-ink)]">
            <Activity size={16} className="mr-2" /> Quick Commands
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2 pt-0">
            <Button
              size="sm"
              color="danger"
              variant="flat"
              startContent={<Lock size={14} />}
              isLoading={cmdLoading === "lock_all-{}"}
              onPress={() => sendCommand("lock_all")}
            >
              Lock All Doors
            </Button>
            <Button
              size="sm"
              variant="flat"
              startContent={<RotateCcw size={14} />}
              isLoading={cmdLoading === "capture_face-{}"}
              onPress={() => sendCommand("capture_face")}
            >
              Test Face Capture
            </Button>
          </CardBody>
        </Card>

        {/* Per-locker cards */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((id) => {
            const sid = String(id);
            const doors = kiosk?.lockers?.[sid];
            const t = timing[sid] ?? { ...DEFAULT_TIMING };

            return (
              <Card
                key={id}
                className="border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <CardHeader className="flex items-center justify-between pb-1">
                  <span className="text-lg font-bold text-[var(--color-ink)]">
                    Locker {String(id).padStart(2, "0")}
                  </span>
                  <div className="flex gap-1">
                    {(["main", "trapdoor", "bottom"] as const).map((door) => {
                      const state = (doors as Record<string, string>)?.[
                        door === "trapdoor"
                          ? "trapdoor"
                          : door === "bottom"
                            ? "bottom"
                            : "main"
                      ];
                      const unlocked = state === "unlocked";
                      return (
                        <Chip
                          key={door}
                          size="sm"
                          className={
                            unlocked
                              ? "border border-green-500 bg-green-500/10 text-green-400 text-xs"
                              : "border border-[var(--color-border)] bg-transparent text-[var(--color-muted)] text-xs"
                          }
                        >
                          {door === "trapdoor"
                            ? "Trap"
                            : door === "bottom"
                              ? "Bot"
                              : "Main"}
                          {unlocked ? " ●" : " ○"}
                        </Chip>
                      );
                    })}
                  </div>
                </CardHeader>

                <Divider />

                <CardBody className="space-y-4 pt-3">
                  {/* Manual door controls */}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                      Manual Controls
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(["main", "trapdoor", "bottom"] as const).map((door) => (
                        <Button
                          key={door}
                          size="sm"
                          variant="flat"
                          color="primary"
                          startContent={<LockOpen size={13} />}
                          isLoading={
                            cmdLoading ===
                            `open_door-${JSON.stringify({ locker_id: id, door })}`
                          }
                          onPress={() =>
                            sendCommand("open_door", { locker_id: id, door })
                          }
                        >
                          Open{" "}
                          {door === "trapdoor"
                            ? "Trap"
                            : door === "bottom"
                              ? "Bottom"
                              : "Main"}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="flat"
                        isLoading={
                          cmdLoading ===
                          `actuator_extend-${JSON.stringify({ locker_id: id })}`
                        }
                        onPress={() =>
                          sendCommand("actuator_extend", { locker_id: id })
                        }
                      >
                        Extend
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        isLoading={
                          cmdLoading ===
                          `actuator_retract-${JSON.stringify({ locker_id: id })}`
                        }
                        onPress={() =>
                          sendCommand("actuator_retract", { locker_id: id })
                        }
                      >
                        Retract
                      </Button>
                    </div>
                  </div>

                  {/* Timing config */}
                  <div>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                      Timing Configuration
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {numInput(
                        "Main Door Open",
                        t.main_door_open_seconds,
                        (v) => updateTiming(sid, "main_door_open_seconds", v),
                        "s",
                      )}
                      {numInput(
                        "Trapdoor Unlock",
                        t.trapdoor_unlock_seconds,
                        (v) => updateTiming(sid, "trapdoor_unlock_seconds", v),
                        "s",
                      )}
                      {numInput(
                        "Bottom Door Open",
                        t.bottom_door_open_seconds,
                        (v) => updateTiming(sid, "bottom_door_open_seconds", v),
                        "s",
                      )}
                      {numInput(
                        "Actuator Push",
                        t.actuator_push_seconds,
                        (v) => updateTiming(sid, "actuator_push_seconds", v),
                        "s",
                      )}
                      {numInput(
                        "Actuator Pull",
                        t.actuator_pull_seconds,
                        (v) => updateTiming(sid, "actuator_pull_seconds", v),
                        "s",
                      )}
                      {numInput(
                        "Actuator Speed",
                        t.actuator_speed_percent,
                        (v) => updateTiming(sid, "actuator_speed_percent", v),
                        "%",
                        10,
                        100,
                      )}
                    </div>
                    <Button
                      size="sm"
                      color="primary"
                      className="mt-4"
                      startContent={<Save size={14} />}
                      isLoading={saving[sid]}
                      onPress={() => saveTiming(sid)}
                    >
                      Save Locker {id} Timing
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>
    </AdminLayout>
  );
}
