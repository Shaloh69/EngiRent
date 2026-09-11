"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Affix,
  AspectRatio,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  LoadingOverlay,
  Notification,
  NumberInput,
  ScrollArea,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  Activity,
  Camera,
  ChevronRight,
  Clock,
  Lock,
  LockOpen,
  Monitor,
  RefreshCw,
  Save,
  Terminal,
  Unlock,
  Wifi,
  WifiOff,
} from "lucide-react";
import api, { isDemoMode } from "@/lib/api";
import { roleColor } from "../theme";

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

// The real deployed kiosk registers itself as "KIOSK-001" (its KIOSK_ID env
// var on the Pi). This page previously hardcoded "kiosk-1" in five places —
// a stale seed value that matched nothing live, so config saves and commands
// went to an ID the hardware never answers to. Same class of bug as the
// Locker.kioskId mismatch fixed server-side 2026-09-03. Only a fallback:
// the real ID still comes from GET /admin/kiosks when that responds.
const FALLBACK_KIOSK_ID = "KIOSK-001";

const DEMO_STATE: KioskState = {
  id: FALLBACK_KIOSK_ID,
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

// Returns a Mantine colour token (was Tailwind classes before the 2026-09-03
// Mantine rebuild). Kept as the log-level convention this project uses
// everywhere: red critical, amber warning, green healthy.
function levelColor(level: string) {
  if (level === "ERROR" || level === "CRITICAL") return "red.4";
  if (level === "WARNING") return "yellow.4";
  if (level === "INFO") return "green.4";
  return "dimmed";
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
    <Stack gap={4}>
      <Text size="xs" fw={600} tt="uppercase" c="dimmed">
        {label}
      </Text>
      <Group gap="xs">
        <NumberInput
          size="xs"
          min={min}
          max={max}
          value={value}
          onChange={(v) => onChange(Number(v))}
          w={96}
          styles={{ input: { textAlign: "center" } }}
        />
        <Text size="xs" c="dimmed">
          {unit}
        </Text>
      </Group>
    </Stack>
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
  const [releasing, setReleasing] = useState<Record<string, boolean>>({});
  // D-63. The CANONICAL locker model, which this page has never had. The
  // `lockers` field above is DOOR state (main/bottom, locked/unlocked) and is
  // the right model for the hardware controls -- but it cannot answer "is this
  // bay actually holding something", which is exactly what Release Locker
  // asks the operator to decide.
  const [bays, setBays] = useState<
    Record<
      string,
      { status: string; isOperational: boolean; currentRentalId: string | null }
    >
  >({});
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
      const [kioskRes, configRes, bayRes] = await Promise.allSettled([
        api.get("/admin/kiosks"),
        api.get(`/admin/kiosks/${FALLBACK_KIOSK_ID}/config`),
        // D-63: the only endpoint that carries Locker.status to a client.
        api.get("/admin/kiosks/lockers"),
      ]);
      if (bayRes.status === "fulfilled") {
        const rows = bayRes.value.data?.data?.lockers ?? [];
        const next: Record<string, { status: string; isOperational: boolean; currentRentalId: string | null }> = {};
        for (const r of rows) {
          next[String(r.lockerNumber)] = {
            status: r.status,
            isOperational: r.isOperational,
            currentRentalId: r.currentRentalId ?? null,
          };
        }
        setBays(next);
      }
      const kioskId =
        kioskRes.status === "fulfilled"
          ? (kioskRes.value.data.data?.kiosks?.[0]?.id ?? FALLBACK_KIOSK_ID)
          : FALLBACK_KIOSK_ID;
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
        await api.put(`/admin/kiosks/${kiosk?.id ?? FALLBACK_KIOSK_ID}/config`, {
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
        await api.post(`/admin/kiosks/${kiosk?.id ?? FALLBACK_KIOSK_ID}/command`, {
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
      await api.post(`/admin/kiosks/${kiosk?.id ?? FALLBACK_KIOSK_ID}/command`, {
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

  // Checklist Stage 9 — a database-state fix independent of hardware, for
  // the "locker thinks it's occupied but isn't" support case. The existing
  // door/actuator buttons above are live hardware commands (need the kiosk
  // online); this clears Locker.status/currentRentalId directly and works
  // even if the kiosk itself is unreachable.
  const releaseLockerByNumber = async (lockerNumber: number) => {
    const sid = String(lockerNumber);
    // D-63: state the ACTUAL state in the prompt. This used to ask the
    // operator whether the locker was "genuinely stuck" while showing them
    // only door state, which cannot answer that.
    const bay = bays[sid];
    const known = bay
      ? `It is currently ${bay.status}${bay.isOperational ? "" : " and NOT operational"}` +
        (bay.currentRentalId
          ? `, with rental ${bay.currentRentalId.slice(0, 8)}… attached.`
          : ", with NO rental attached.")
      : "Its current state could not be read, so this cannot tell you whether it is stuck.";
    if (
      !window.confirm(
        `Release Locker ${sid.padStart(2, "0")}?

${known}

Releasing clears the occupied state and detaches any rental — only do this if the locker is genuinely stuck.`,
      )
    ) {
      return;
    }
    setReleasing((p) => ({ ...p, [sid]: true }));
    try {
      if (isDemoMode) {
        await new Promise((r) => setTimeout(r, 600));
        showToast(`Demo: Locker ${sid.padStart(2, "0")} released`);
        return;
      }
      const res = await api.post(`/admin/kiosks/lockers/by-number/${sid}/release`);
      showToast(res.data?.message ?? `Locker ${sid.padStart(2, "0")} released`);
    } catch (e: any) {
      showToast(e?.response?.data?.error ?? `Failed to release Locker ${sid}`, false);
    } finally {
      setReleasing((p) => ({ ...p, [sid]: false }));
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AdminLayout>
        <Center h={256}>
          <Loader size="lg" />
        </Center>
      </AdminLayout>
    );
  }

  const isOnline = kiosk?.status === "online";
  const isOffline = kiosk?.status === "offline";

  // ── Per-locker tab content ────────────────────────────────────────────────
  function LockerTab({ id }: { id: number }) {
    const sid = String(id);
    const doors = kiosk?.lockers?.[sid] ?? { main: "locked", bottom: "locked" };
    // D-63: canonical state, shown ALONGSIDE door state rather than instead of
    // it — the two answer different questions and this page legitimately needs
    // both. Absent renders as "unknown", never as a guess (D-53's rule).
    const bay = bays[sid];
    const t = timing[sid] ?? { ...DEFAULT_TIMING };
    const snap = snapshots[sid];
    const cmdKey = (cmd: string, extra = {}) =>
      `${cmd}-${JSON.stringify({ locker_id: id, ...extra })}`;

    return (
      <Stack gap="md">
        {/* D-63 — the canonical bay state. This page could RELEASE a locker
            (clearing its occupied state and detaching a rental) while showing
            only door lock state, which cannot tell you whether a bay holds
            anything. Shown alongside the door controls, not instead of them:
            "is the door open right now" and "does this bay hold an item" are
            different questions and a hardware page needs both. */}
        <Card withBorder radius="md" padding="lg">
          <Group gap="xs" mb="sm">
            <ThemeIcon variant="light" color={roleColor.review} size="sm">
              <Activity size={13} />
            </ThemeIcon>
            <Text fw={600} size="sm">
              Bay state (server)
            </Text>
          </Group>
          {bay ? (
            <Group gap="sm" wrap="wrap">
              <Badge
                variant="light"
                color={
                  !bay.isOperational
                    ? roleColor.warning
                    : bay.status === "AVAILABLE"
                      ? roleColor.success
                      : bay.status === "OCCUPIED" || bay.status === "RESERVED"
                        ? roleColor.review
                        : roleColor.warning
                }
              >
                {bay.isOperational ? bay.status : `${bay.status} · NOT OPERATIONAL`}
              </Badge>
              <Text size="sm" c="dimmed">
                {bay.currentRentalId
                  ? `Rental ${bay.currentRentalId.slice(0, 8)}… attached`
                  : "No rental attached"}
              </Text>
              {bay.status === "OCCUPIED" && !bay.currentRentalId ? (
                <Badge variant="light" color={roleColor.warning}>
                  Occupied with no rental — this is the “stuck” case
                </Badge>
              ) : null}
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              Unknown — the server’s locker state could not be read. Releasing
              this bay would be a guess.
            </Text>
          )}
        </Card>

        {/* Camera snapshot */}
        <Card withBorder radius="md" padding="lg">
          <Group gap="xs" mb="sm">
            <Camera size={15} />
            <Text fw={600}>
              Camera Snapshot — Locker {String(id).padStart(2, "0")}
            </Text>
          </Group>
          <Divider />
          <Stack gap="sm" pt="md">
            <AspectRatio ratio={4 / 3}>
              <Box
                pos="relative"
                style={{
                  overflow: "hidden",
                  borderRadius: "var(--mantine-radius-md)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface-soft)",
                }}
              >
                {snap ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={snap}
                    alt={`Locker ${id} snapshot`}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <Stack align="center" justify="center" gap="xs" h="100%">
                    <Camera size={36} opacity={0.3} />
                    <Text size="sm" c="dimmed">
                      No snapshot yet
                    </Text>
                    <Text size="xs" c="dimmed" opacity={0.7}>
                      {'Click "Take Snapshot" to capture'}
                    </Text>
                  </Stack>
                )}
                <LoadingOverlay visible={!!snapLoading[sid]} />
              </Box>
            </AspectRatio>
            <Button
              size="sm"
              variant="light"
              leftSection={<Camera size={14} />}
              loading={snapLoading[sid]}
              disabled={!isOnline && !isDemoMode}
              onClick={() => takeSnapshot(id)}
            >
              Take Snapshot
            </Button>
          </Stack>
        </Card>

        {/* Door status */}
        <Card withBorder radius="md" padding="lg">
          <Group gap="xs" mb="sm">
            <Monitor size={15} />
            <Text fw={600}>Door Status</Text>
          </Group>
          <Group gap="sm">
            {(["main", "bottom"] as const).map((door) => {
              const unlocked =
                (doors as Record<string, string>)?.[door] === "unlocked";
              return (
                <Badge
                  key={door}
                  size="sm"
                  variant={unlocked ? "light" : "outline"}
                  color={unlocked ? roleColor.success : "gray"}
                  leftSection={
                    unlocked ? <LockOpen size={12} /> : <Lock size={12} />
                  }
                >
                  {door === "main" ? "Main" : "Bottom"}{" "}
                  {unlocked ? "Open" : "Locked"}
                </Badge>
              );
            })}
          </Group>
        </Card>

        {/* Manual controls */}
        <Card withBorder radius="md" padding="lg">
          <Group gap="xs" mb="sm">
            <Activity size={15} />
            <Text fw={600}>Manual Controls</Text>
          </Group>
          <Group gap="xs">
            {(["main", "bottom"] as const).map((door) => {
              const doorKey = door === "main" ? "main_door" : "bottom_door";
              return (
                <Button
                  key={door}
                  size="sm"
                  variant="light"
                  color="primary"
                  leftSection={<LockOpen size={13} />}
                  loading={
                    cmdLoading === cmdKey("open_door", { door: doorKey })
                  }
                  disabled={!isOnline && !isDemoMode}
                  onClick={() =>
                    sendCommand("open_door", { locker_id: id, door: doorKey })
                  }
                >
                  Open {door === "main" ? "Main" : "Bottom"}
                </Button>
              );
            })}
            <Button
              size="sm"
              variant="light"
              loading={cmdLoading === cmdKey("actuator_extend")}
              disabled={!isOnline && !isDemoMode}
              onClick={() => sendCommand("actuator_extend", { locker_id: id })}
            >
              Extend
            </Button>
            <Button
              size="sm"
              variant="light"
              loading={cmdLoading === cmdKey("actuator_retract")}
              disabled={!isOnline && !isDemoMode}
              onClick={() => sendCommand("actuator_retract", { locker_id: id })}
            >
              Retract
            </Button>
            {/* Checklist Stage 9 — deliberately NOT gated on `isOnline`,
                unlike the hardware commands above: this is a database-only
                fix for exactly the case where the kiosk (and so the locker)
                is unreachable but still needs to be cleared. */}
            <Button
              size="sm"
              variant="light"
              color="red"
              leftSection={<Unlock size={13} />}
              loading={releasing[sid]}
              onClick={() => releaseLockerByNumber(id)}
            >
              Release
            </Button>
          </Group>
        </Card>

        {/* Timing */}
        <Card withBorder radius="md" padding="lg">
          <Group gap="xs" mb="sm">
            <Clock size={15} />
            <Text fw={600}>Timing Configuration</Text>
          </Group>
          <Divider />
          <Stack gap="md" pt="md">
            <SimpleGrid cols={2} spacing="md">
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
            </SimpleGrid>
            <Button
              size="sm"
              color="primary"
              leftSection={<Save size={14} />}
              loading={saving[sid]}
              onClick={() => saveTiming(sid)}
            >
              Save Locker {String(id).padStart(2, "0")} Timing
            </Button>
          </Stack>
        </Card>
      </Stack>
    );
  }

  // Face cam tab removed 2026-09-03 — the kiosk's face camera was physically
  // removed (design mandate §2.13). Identity verification now happens in the
  // mobile app, so there is no longer a hardware component here for the
  // Components Check to exercise.

  return (
    <AdminLayout>
      {/* Toast */}
      {toast && (
        <Affix position={{ bottom: 24, right: 24 }}>
          <Notification
            color={toast.ok ? roleColor.success : roleColor.critical}
            withCloseButton={false}
            withBorder
          >
            {toast.msg}
          </Notification>
        </Affix>
      )}

      <Stack gap="lg">
        {/* ── Hero / Status header ─────────────────────────────────────────── */}
        <Card
          withBorder
          radius="md"
          padding="lg"
          style={{
            borderColor: isOnline
              ? "var(--mantine-color-green-6)"
              : isOffline
                ? "var(--mantine-color-red-6)"
                : undefined,
          }}
        >
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <div>
              <Group gap="sm" mb="xs">
                <ThemeIcon
                  size={40}
                  radius="md"
                  variant="light"
                  color={isOnline ? roleColor.success : roleColor.critical}
                >
                  <Text fw={900} size="sm">
                    ER
                  </Text>
                </ThemeIcon>
                <div>
                  <Title order={2} fw={800} lh={1}>
                    Kiosk Control
                  </Title>
                  <Text size="xs" c="dimmed" tt="uppercase" mt={4}>
                    {kiosk?.id ?? FALLBACK_KIOSK_ID}
                  </Text>
                </div>
              </Group>
              <Text size="sm" c="dimmed">
                Manage lockers, review snapshots, and monitor live logs
              </Text>
            </div>

            <Stack gap="xs" align="flex-end">
              <Group gap="xs">
                <Badge
                  size="sm"
                  variant="light"
                  color={isOnline ? roleColor.success : roleColor.critical}
                  leftSection={
                    isOnline ? <Wifi size={12} /> : <WifiOff size={12} />
                  }
                >
                  {isOnline
                    ? "Online"
                    : kiosk?.status === "error"
                      ? "Error"
                      : "Offline"}
                </Badge>
                <Button
                  size="sm"
                  variant="light"
                  leftSection={<RefreshCw size={13} />}
                  onClick={fetchState}
                >
                  Refresh
                </Button>
              </Group>
              {kiosk?.lastSeen && (
                <Text size="xs" c="dimmed">
                  Last seen: {new Date(kiosk.lastSeen).toLocaleTimeString()}
                </Text>
              )}
            </Stack>
          </Group>

          {/* Locker status mini-row */}
          <Group gap="sm" mt="lg" wrap="wrap">
            {[1, 2, 3, 4].map((id) => {
              const doors = kiosk?.lockers?.[String(id)];
              const anyOpen =
                doors?.main === "unlocked" || doors?.bottom === "unlocked";
              return (
                <Card
                  key={id}
                  withBorder
                  radius="sm"
                  py={8}
                  px="sm"
                  style={{
                    borderColor: anyOpen
                      ? "var(--mantine-color-blue-6)"
                      : undefined,
                  }}
                >
                  <Group gap={6} wrap="nowrap">
                    {anyOpen ? <LockOpen size={13} /> : <Lock size={13} />}
                    <Text size="sm" fw={600}>
                      Locker {String(id).padStart(2, "0")}
                    </Text>
                    <ChevronRight size={13} opacity={0.4} />
                    <Text
                      size="sm"
                      fw={600}
                      c={anyOpen ? "blue" : "dimmed"}
                    >
                      {anyOpen ? "Open" : "Locked"}
                    </Text>
                  </Group>
                </Card>
              );
            })}
          </Group>

          {/* Global commands row */}
          <Group gap="xs" mt="md">
            <Button
              size="sm"
              color={roleColor.critical}
              variant="light"
              leftSection={<Lock size={13} />}
              loading={cmdLoading === "lock_all-{}"}
              disabled={!isOnline && !isDemoMode}
              onClick={() => sendCommand("lock_all")}
              title="This is a software command over the network — it depends on the kiosk's process and connection being alive. It is not a substitute for a physical emergency-stop button."
            >
              Emergency Stop — Lock All Doors
            </Button>
          </Group>
        </Card>

        {/* ── Tab navigation ───────────────────────────────────────────────── */}
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v ?? "locker-1")}
          variant="outline"
          color="teal"
        >
          <Tabs.List mb="md">
            {[1, 2, 3, 4].map((id) => (
              <Tabs.Tab key={`locker-${id}`} value={`locker-${id}`}>
                {`Locker ${String(id).padStart(2, "0")}`}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          {[1, 2, 3, 4].map((id) => (
            <Tabs.Panel key={`locker-${id}`} value={`locker-${id}`}>
              <LockerTab id={id} />
            </Tabs.Panel>
          ))}
        </Tabs>

        {/* ── Live Pi Log terminal ─────────────────────────────────────────── */}
        <Card withBorder radius="md" padding="lg">
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <Terminal size={15} />
              <Text fw={600}>Live Pi Logs</Text>
              {logs.length > 0 && (
                <Text size="xs" c="dimmed">
                  ({logs.length} entries)
                </Text>
              )}
            </Group>
            <Button size="xs" variant="subtle" onClick={() => setLogs([])}>
              Clear
            </Button>
          </Group>
          <Divider />
          {/* Deliberately kept monospace and dense — this is a real log
              terminal, so terminal conventions are the correct design here,
              not a leftover to normalise away. */}
          <ScrollArea h={288} mt="xs">
            <Box
              ff="monospace"
              fz={12}
              p="md"
              style={{
                background: "var(--mantine-color-dark-9)",
                borderRadius: "var(--mantine-radius-sm)",
              }}
            >
              {logs.length === 0 ? (
                <Text c="dimmed" ta="center" mt="xl" opacity={0.6}>
                  {isDemoMode
                    ? "Demo mode — no live logs"
                    : "Waiting for Pi logs…"}
                </Text>
              ) : (
                logs.map((entry, i) => (
                  <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
                    <Text span c="dimmed" fz={12} ff="monospace" style={{ flexShrink: 0 }}>
                      {fmtTime(entry.ts)}
                    </Text>
                    <Text
                      span
                      fw={700}
                      fz={12}
                      ff="monospace"
                      c={levelColor(entry.level)}
                      w={52}
                      style={{ flexShrink: 0 }}
                    >
                      [{(entry.level ?? "INFO").substring(0, 4)}]
                    </Text>
                    <Text span c="dimmed" fz={12} ff="monospace" w={140} truncate style={{ flexShrink: 0 }}>
                      {entry.module}
                    </Text>
                    <Text span fz={12} ff="monospace" style={{ minWidth: 0, wordBreak: "break-all" }}>
                      {entry.message}
                    </Text>
                  </Group>
                ))
              )}
              <div ref={logEndRef} />
            </Box>
          </ScrollArea>
        </Card>
      </Stack>
    </AdminLayout>
  );
}
