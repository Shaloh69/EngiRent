"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Spinner,
  Tab,
  Tabs,
} from "@heroui/react";
import {
  Activity,
  Camera,
  ChevronRight,
  Clock,
  Lock,
  LockOpen,
  Monitor,
  RefreshCw,
  RotateCcw,
  Save,
  Terminal,
  Wifi,
  WifiOff,
} from "lucide-react";
import api, { isDemoMode } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LockerTiming {
  main_door_open_seconds: number;
  bottom_door_open_seconds: number;
  actuator_extend_seconds: number;
  actuator_retract_seconds: number;
}

interface KioskState {
  id: string;
  status: "online" | "offline" | "error" | string;
  lastSeen: string | null;
  lockers: Record<string, { main: string; bottom: string }>;
  timing: Record<string, LockerTiming>;
}

interface LogEntry {
  level: string;
  module: string;
  message: string;
  ts: number;
  kiosk_id?: string;
}

const DEFAULT_TIMING: LockerTiming = {
  main_door_open_seconds: 15,
  bottom_door_open_seconds: 15,
  actuator_extend_seconds: 5,
  actuator_retract_seconds: 5,
};

const DEMO_STATE: KioskState = {
  id: "kiosk-1",
  status: "online",
  lastSeen: new Date().toISOString(),
  lockers: {
    "1": { main: "locked", bottom: "locked" },
    "2": { main: "locked", bottom: "locked" },
    "3": { main: "locked", bottom: "locked" },
    "4": { main: "locked", bottom: "locked" },
  },
  timing: {
    "1": { ...DEFAULT_TIMING },
    "2": { ...DEFAULT_TIMING },
    "3": { ...DEFAULT_TIMING },
    "4": { ...DEFAULT_TIMING },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function levelColor(level: string) {
  if (level === "ERROR" || level === "CRITICAL") return "text-red-400";
  if (level === "WARNING") return "text-amber-400";
  if (level === "INFO") return "text-green-400";
  return "text-[var(--color-muted)]";
}

function NumInput({
  label,
  value,
  onChange,
  unit,
  min = 1,
  max = 120,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        {label}
      </span>
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function KioskPage() {
  const [kiosk, setKiosk] = useState<KioskState | null>(null);
  const [timing, setTiming] = useState<Record<string, LockerTiming>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [cmdLoading, setCmdLoading] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, string>>({});
  const [snapLoading, setSnapLoading] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState("locker-1");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Fetch initial state ───────────────────────────────────────────────────
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

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // ── SSE real-time stream with auto-reconnect ─────────────────────────────
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

                  if (eventName === "kiosk_online") {
                    setKiosk((p) =>
                      p
                        ? {
                            ...p,
                            status: "online",
                            lastSeen: new Date().toISOString(),
                          }
                        : p,
                    );
                  } else if (eventName === "kiosk_status") {
                    const lockers = data.lockers as
                      | KioskState["lockers"]
                      | undefined;
                    setKiosk((p) =>
                      p
                        ? {
                            ...p,
                            status: "online",
                            lastSeen: new Date().toISOString(),
                            ...(lockers ? { lockers } : {}),
                          }
                        : p,
                    );
                  } else if (eventName === "kiosk_offline") {
                    setKiosk((p) => (p ? { ...p, status: "offline" } : p));
                  } else if (eventName === "kiosk_error") {
                    setKiosk((p) => (p ? { ...p, status: "error" } : p));
                  } else if (eventName === "kiosk_log") {
                    const entry = data as unknown as LogEntry;
                    setLogs((prev) => [...prev, entry].slice(-300));
                    setTimeout(
                      () =>
                        logEndRef.current?.scrollIntoView({
                          behavior: "smooth",
                        }),
                      50,
                    );
                  } else if (eventName === "kiosk_admin_snapshot") {
                    const lockerId = String(data.locker_id);
                    const urls = data.image_urls as string[] | undefined;
                    if (urls && urls.length > 0) {
                      setSnapshots((p) => ({ ...p, [lockerId]: urls[0] }));
                      setSnapLoading((p) => ({ ...p, [lockerId]: false }));
                      showToast(
                        `Snapshot captured for Locker ${lockerId.padStart(2, "0")}`,
                      );
                    }
                  }
                } catch {
                  /* malformed JSON */
                }
              }
            }
          }
        } catch {
          // AbortError means cleanup — stop retrying
          if (aborted) break;
        }
        // Wait 3 s before reconnecting (unless cleanup)
        if (!aborted) await new Promise((r) => setTimeout(r, 3000));
      }
    };

    connect();
    return () => {
      aborted = true;
      ctrl.abort();
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const updateTiming = (id: string, field: keyof LockerTiming, val: number) =>
    setTiming((p) => ({ ...p, [id]: { ...p[id], [field]: val } }));

  const saveTiming = async (lockerId: string) => {
    setSaving((p) => ({ ...p, [lockerId]: true }));
    try {
      if (!isDemoMode) {
        await api.put(`/admin/kiosks/${kiosk?.id ?? "kiosk-1"}/config`, {
          config: { lockers: { ...timing, [lockerId]: timing[lockerId] } },
        });
      }
      showToast(`Locker ${lockerId.padStart(2, "0")} timing saved`);
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

  const takeSnapshot = async (lockerId: number) => {
    const sid = String(lockerId);
    setSnapLoading((p) => ({ ...p, [sid]: true }));
    try {
      if (isDemoMode) {
        await new Promise((r) => setTimeout(r, 1200));
        setSnapshots((p) => ({
          ...p,
          [sid]: `https://placehold.co/640x480/111827/94a3b8?text=Demo+Snapshot+L${lockerId}`,
        }));
        setSnapLoading((p) => ({ ...p, [sid]: false }));
        showToast(
          `Demo snapshot for Locker ${String(lockerId).padStart(2, "0")}`,
        );
        return;
      }
      await api.post(`/admin/kiosks/${kiosk?.id ?? "kiosk-1"}/command`, {
        action: "capture_image",
        locker_id: lockerId,
        num_frames: 1,
      });
      showToast("Snapshot requested — waiting for Pi…");
      // Actual URL arrives via SSE kiosk_admin_snapshot
    } catch {
      showToast("Failed to request snapshot", false);
      setSnapLoading((p) => ({ ...p, [sid]: false }));
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
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
  const isOffline = kiosk?.status === "offline";

  // ── Per-locker tab content ────────────────────────────────────────────────
  function LockerTab({ id }: { id: number }) {
    const sid = String(id);
    const doors = kiosk?.lockers?.[sid] ?? { main: "locked", bottom: "locked" };
    const t = timing[sid] ?? { ...DEFAULT_TIMING };
    const snap = snapshots[sid];
    const cmdKey = (cmd: string, extra = {}) =>
      `${cmd}-${JSON.stringify({ locker_id: id, ...extra })}`;

    return (
      <div className="space-y-4">
        {/* Camera snapshot */}
        <Card className="border border-[var(--color-border)] bg-[var(--color-surface)]">
          <CardHeader className="pb-2 flex items-center gap-2 font-semibold text-[var(--color-ink)]">
            <Camera size={15} />
            <span>Camera Snapshot — Locker {String(id).padStart(2, "0")}</span>
          </CardHeader>
          <Divider />
          <CardBody className="pt-3 space-y-3">
            <div
              className="relative w-full overflow-hidden rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]"
              style={{ aspectRatio: "4/3" }}
            >
              {snap ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={snap}
                  alt={`Locker ${id} snapshot`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
                  <Camera size={36} className="opacity-30" />
                  <p className="text-sm">No snapshot yet</p>
                  <p className="text-xs opacity-60">
                    {'Click "Take Snapshot" to capture'}
                  </p>
                </div>
              )}
              {snapLoading[sid] && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-xl">
                  <Spinner size="lg" />
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="flat"
              startContent={<Camera size={14} />}
              isLoading={snapLoading[sid]}
              isDisabled={!isOnline && !isDemoMode}
              onPress={() => takeSnapshot(id)}
            >
              Take Snapshot
            </Button>
          </CardBody>
        </Card>

        {/* Door status */}
        <Card className="border border-[var(--color-border)] bg-[var(--color-surface)]">
          <CardHeader className="pb-1 font-semibold text-[var(--color-ink)]">
            <Monitor size={15} className="mr-2" />
            Door Status
          </CardHeader>
          <CardBody className="pt-2 flex flex-row gap-3">
            {(["main", "bottom"] as const).map((door) => {
              const unlocked =
                (doors as Record<string, string>)?.[door] === "unlocked";
              return (
                <Chip
                  key={door}
                  size="sm"
                  startContent={
                    unlocked ? <LockOpen size={12} /> : <Lock size={12} />
                  }
                  className={
                    unlocked
                      ? "border border-green-500 bg-green-500/10 text-green-400"
                      : "border border-[var(--color-border)] bg-transparent text-[var(--color-muted)]"
                  }
                >
                  {door === "main" ? "Main" : "Bottom"}{" "}
                  {unlocked ? "Open" : "Locked"}
                </Chip>
              );
            })}
          </CardBody>
        </Card>

        {/* Manual controls */}
        <Card className="border border-[var(--color-border)] bg-[var(--color-surface)]">
          <CardHeader className="pb-2 font-semibold text-[var(--color-ink)]">
            <Activity size={15} className="mr-2" />
            Manual Controls
          </CardHeader>
          <CardBody className="pt-0 flex flex-wrap gap-2">
            {(["main", "bottom"] as const).map((door) => {
              const doorKey = door === "main" ? "main_door" : "bottom_door";
              return (
                <Button
                  key={door}
                  size="sm"
                  variant="flat"
                  color="primary"
                  startContent={<LockOpen size={13} />}
                  isLoading={
                    cmdLoading === cmdKey("open_door", { door: doorKey })
                  }
                  isDisabled={!isOnline && !isDemoMode}
                  onPress={() =>
                    sendCommand("open_door", { locker_id: id, door: doorKey })
                  }
                >
                  Open {door === "main" ? "Main" : "Bottom"}
                </Button>
              );
            })}
            <Button
              size="sm"
              variant="flat"
              isLoading={cmdLoading === cmdKey("actuator_extend")}
              isDisabled={!isOnline && !isDemoMode}
              onPress={() => sendCommand("actuator_extend", { locker_id: id })}
            >
              Extend
            </Button>
            <Button
              size="sm"
              variant="flat"
              isLoading={cmdLoading === cmdKey("actuator_retract")}
              isDisabled={!isOnline && !isDemoMode}
              onPress={() => sendCommand("actuator_retract", { locker_id: id })}
            >
              Retract
            </Button>
          </CardBody>
        </Card>

        {/* Timing */}
        <Card className="border border-[var(--color-border)] bg-[var(--color-surface)]">
          <CardHeader className="pb-2 font-semibold text-[var(--color-ink)]">
            <Clock size={15} className="mr-2" />
            Timing Configuration
          </CardHeader>
          <Divider />
          <CardBody className="pt-3 space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <NumInput
                label="Main Door Open"
                unit="s"
                value={t.main_door_open_seconds}
                onChange={(v) => updateTiming(sid, "main_door_open_seconds", v)}
              />
              <NumInput
                label="Bottom Door Open"
                unit="s"
                value={t.bottom_door_open_seconds}
                onChange={(v) =>
                  updateTiming(sid, "bottom_door_open_seconds", v)
                }
              />
              <NumInput
                label="Actuator Extend"
                unit="s"
                value={t.actuator_extend_seconds}
                onChange={(v) =>
                  updateTiming(sid, "actuator_extend_seconds", v)
                }
              />
              <NumInput
                label="Actuator Retract"
                unit="s"
                value={t.actuator_retract_seconds}
                onChange={(v) =>
                  updateTiming(sid, "actuator_retract_seconds", v)
                }
              />
            </div>
            <Button
              size="sm"
              color="primary"
              startContent={<Save size={14} />}
              isLoading={saving[sid]}
              onPress={() => saveTiming(sid)}
            >
              Save Locker {String(id).padStart(2, "0")} Timing
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  // ── Face cam tab content ──────────────────────────────────────────────────
  function FaceCamTab() {
    const snap = snapshots["face"];
    return (
      <div className="space-y-4">
        <Card className="border border-[var(--color-border)] bg-[var(--color-surface)]">
          <CardHeader className="pb-2 flex items-center gap-2 font-semibold text-[var(--color-ink)]">
            <Camera size={15} />
            <span>Face Camera (Index 4)</span>
          </CardHeader>
          <Divider />
          <CardBody className="pt-3 space-y-3">
            <div
              className="relative w-full overflow-hidden rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]"
              style={{ aspectRatio: "4/3" }}
            >
              {snap ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={snap}
                  alt="Face camera"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
                  <Camera size={36} className="opacity-30" />
                  <p className="text-sm">No snapshot</p>
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="flat"
              startContent={<RotateCcw size={14} />}
              isLoading={cmdLoading === "capture_face-{}"}
              isDisabled={!isOnline && !isDemoMode}
              onPress={() => sendCommand("capture_face")}
            >
              Test Face Capture
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

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
        {/* ── Hero / Status header ─────────────────────────────────────────── */}
        <div
          className={`relative overflow-hidden rounded-2xl border p-6 ${
            isOnline
              ? "border-green-500/25 bg-gradient-to-br from-green-950/30 via-[var(--color-surface)] to-[var(--color-surface)]"
              : isOffline
                ? "border-red-500/25 bg-gradient-to-br from-red-950/30 via-[var(--color-surface)] to-[var(--color-surface)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)]"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black ${
                    isOnline
                      ? "bg-green-500/15 text-green-400"
                      : "bg-red-500/15 text-red-400"
                  }`}
                >
                  ER
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold text-[var(--color-ink)] leading-none">
                    Kiosk Control
                  </h1>
                  <p className="text-xs text-[var(--color-muted)] mt-1 uppercase tracking-wider">
                    {kiosk?.id ?? "kiosk-1"}
                  </p>
                </div>
              </div>
              <p className="text-sm text-[var(--color-muted)]">
                Manage lockers, review snapshots, and monitor live logs
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <Chip
                  size="sm"
                  startContent={
                    isOnline ? <Wifi size={12} /> : <WifiOff size={12} />
                  }
                  className={
                    isOnline
                      ? "border border-green-500 bg-green-500/10 text-green-400"
                      : "border border-red-500 bg-red-500/10 text-red-400"
                  }
                >
                  {isOnline
                    ? "Online"
                    : kiosk?.status === "error"
                      ? "Error"
                      : "Offline"}
                </Chip>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<RefreshCw size={13} />}
                  onPress={fetchState}
                >
                  Refresh
                </Button>
              </div>
              {kiosk?.lastSeen && (
                <p className="text-xs text-[var(--color-muted)]">
                  Last seen: {new Date(kiosk.lastSeen).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>

          {/* Locker status mini-row */}
          <div className="mt-5 flex flex-wrap gap-3">
            {[1, 2, 3, 4].map((id) => {
              const doors = kiosk?.lockers?.[String(id)];
              const anyOpen =
                doors?.main === "unlocked" || doors?.bottom === "unlocked";
              return (
                <div
                  key={id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    anyOpen
                      ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                      : "border-[var(--color-border)] bg-transparent text-[var(--color-muted)]"
                  }`}
                >
                  {anyOpen ? <LockOpen size={13} /> : <Lock size={13} />}
                  <span>Locker {String(id).padStart(2, "0")}</span>
                  <ChevronRight size={13} className="opacity-40" />
                  <span
                    className={
                      anyOpen ? "text-blue-400" : "text-[var(--color-muted)]"
                    }
                  >
                    {anyOpen ? "Open" : "Locked"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Global commands row */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              color="danger"
              variant="flat"
              startContent={<Lock size={13} />}
              isLoading={cmdLoading === "lock_all-{}"}
              isDisabled={!isOnline && !isDemoMode}
              onPress={() => sendCommand("lock_all")}
            >
              Lock All Doors
            </Button>
          </div>
        </div>

        {/* ── Tab navigation ───────────────────────────────────────────────── */}
        <Tabs
          selectedKey={activeTab}
          onSelectionChange={(k) => setActiveTab(k as string)}
          variant="underlined"
          classNames={{ tabList: "gap-4", cursor: "bg-[var(--color-primary)]" }}
        >
          {[1, 2, 3, 4].map((id) => (
            <Tab
              key={`locker-${id}`}
              title={`Locker ${String(id).padStart(2, "0")}`}
            >
              <LockerTab id={id} />
            </Tab>
          ))}
          <Tab key="face" title="Face Cam">
            <FaceCamTab />
          </Tab>
        </Tabs>

        {/* ── Live Pi Log terminal ─────────────────────────────────────────── */}
        <Card className="border border-[var(--color-border)] bg-[var(--color-surface)]">
          <CardHeader className="pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
              <Terminal size={15} />
              <span>Live Pi Logs</span>
              {logs.length > 0 && (
                <span className="text-xs text-[var(--color-muted)] font-normal">
                  ({logs.length} entries)
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="flat"
              onPress={() => setLogs([])}
              className="text-xs text-[var(--color-muted)]"
            >
              Clear
            </Button>
          </CardHeader>
          <Divider />
          <CardBody className="p-0">
            <div className="h-72 overflow-y-auto bg-black/40 rounded-b-xl font-mono text-[12px] p-4 space-y-0.5">
              {logs.length === 0 ? (
                <p className="text-[var(--color-muted)] opacity-50 text-center mt-8">
                  {isDemoMode
                    ? "Demo mode — no live logs"
                    : "Waiting for Pi logs…"}
                </p>
              ) : (
                logs.map((entry, i) => (
                  <div key={i} className="flex gap-2 leading-relaxed">
                    <span className="text-[var(--color-muted)] whitespace-nowrap flex-shrink-0">
                      {fmtTime(entry.ts)}
                    </span>
                    <span
                      className={`font-bold flex-shrink-0 w-14 ${levelColor(entry.level)}`}
                    >
                      [{(entry.level ?? "INFO").substring(0, 4)}]
                    </span>
                    <span className="text-[var(--color-muted)] flex-shrink-0 w-36 truncate">
                      {entry.module}
                    </span>
                    <span className="text-[var(--color-ink)] opacity-80 min-w-0 break-all">
                      {entry.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </CardBody>
        </Card>
      </div>
    </AdminLayout>
  );
}
