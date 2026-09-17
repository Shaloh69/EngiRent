/**
 * The per-bay timings the kiosk says it is actually using.
 *
 * The Pi's `kiosk_config.json` is hand-calibrated per locker and is the only
 * source the hardware reads. Before 2026-09-17 the server never knew it: the
 * admin console showed demo placeholders (D-83 — and saving those would have
 * overwritten the real file), and the phone's door countdown was a hardcoded
 * 15 even though bay 2 unlocks for 5 (D-82).
 *
 * The kiosk now reports its file when it connects and again after it saves a
 * pushed config (`kiosk:timing_report`), and this store keeps the latest report
 * per kiosk. Read-only from the server's side: nothing here is ever sent back to
 * the Pi.
 *
 * In-memory: a restart clears it, and the kiosk re-reports within seconds of
 * reconnecting, which is exactly when a stale value would be most misleading.
 */

export interface LockerTiming {
  main_door_open_seconds: number;
  bottom_door_open_seconds: number;
  actuator_extend_seconds: number;
  actuator_retract_seconds: number;
}

export interface TimingReport {
  lockers: Record<string, LockerTiming>;
  reportedAt: number;
}

const FIELDS: (keyof LockerTiming)[] = [
  "main_door_open_seconds",
  "bottom_door_open_seconds",
  "actuator_extend_seconds",
  "actuator_retract_seconds",
];

/** Generous bounds: a value outside them is a corrupted report, not a real
 *  calibration, and must not be shown to an operator as one. */
const MIN_SECONDS = 0;
const MAX_SECONDS = 600;

const reports = new Map<string, TimingReport>();

/**
 * Validates a raw report from the socket. Returns only the bays whose four
 * values are all finite numbers in range; a bay with any bad field is dropped
 * whole rather than half-shown.
 */
export function sanitiseLockers(raw: unknown): Record<string, LockerTiming> {
  const out: Record<string, LockerTiming> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [bay, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{1,2}$/.test(bay) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const ok = FIELDS.every(
      (f) =>
        typeof v[f] === "number" &&
        Number.isFinite(v[f] as number) &&
        (v[f] as number) > MIN_SECONDS &&
        (v[f] as number) <= MAX_SECONDS,
    );
    if (!ok) continue;
    out[bay] = {
      main_door_open_seconds: v.main_door_open_seconds as number,
      bottom_door_open_seconds: v.bottom_door_open_seconds as number,
      actuator_extend_seconds: v.actuator_extend_seconds as number,
      actuator_retract_seconds: v.actuator_retract_seconds as number,
    };
  }
  return out;
}

export function recordTimingReport(kioskId: string, rawLockers: unknown): TimingReport | null {
  const lockers = sanitiseLockers(rawLockers);
  if (Object.keys(lockers).length === 0) return null;
  const report = { lockers, reportedAt: Date.now() };
  reports.set(kioskId, report);
  return report;
}

export function getTimingReport(kioskId: string): TimingReport | undefined {
  return reports.get(kioskId);
}

/**
 * The real number of seconds a door stays unlocked, or `undefined` when the
 * kiosk has not reported. Callers decide their own fallback — and should say
 * it is one.
 */
export function doorOpenSeconds(
  kioskId: string,
  lockerNumber: string,
  door: "main_door" | "bottom_door",
): number | undefined {
  const bay = reports.get(kioskId)?.lockers[String(parseInt(lockerNumber, 10))];
  if (!bay) return undefined;
  return door === "bottom_door" ? bay.bottom_door_open_seconds : bay.main_door_open_seconds;
}

/** Test seam only. */
export function _clearTimingReports(): void {
  reports.clear();
}
