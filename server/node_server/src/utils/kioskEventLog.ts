import kioskEventBus from "./kioskEventBus";

/**
 * Rolling in-memory log of recent events per kiosk, so a "kiosk problem"
 * feedback report can carry what actually happened rather than just a kiosk
 * ID and a timestamp.
 *
 * kioskEventBus (see that file) is a plain pub/sub EventEmitter — SSE
 * listeners subscribe to it live, but nothing ever kept history, so once a
 * moment passed there was no way to check "did locker 3 actually get a
 * release command right before this student reported it stuck". This module
 * is the smallest fix: keep the last MAX_EVENTS_PER_KIOSK per kiosk in
 * memory and let a feedback submission snapshot it at the moment of report.
 *
 * Deliberately not persisted to the database — this is debugging context for
 * triage, not a system of record. The admin-facing kiosk event stream this
 * bus already serves (adminController's SSE endpoint) remains the durable
 * live view; this is only a short-lived rearview mirror.
 */

const MAX_EVENTS_PER_KIOSK = 40;

// Every event type kiosk sockets emit onto the bus (see index.ts's
// `kioskEventBus.emit(...)` call sites) — kept as one list so adding a new
// kiosk event type server-side is a one-line change here too.
const TRACKED_EVENTS = [
  "kiosk_online",
  "kiosk_offline",
  "kiosk_status",
  "kiosk_ack",
  "kiosk_error",
  "kiosk_log",
  "kiosk_self_test",
  "kiosk_emergency",
  "kiosk_admin_snapshot",
  "kiosk_session_start",
] as const;

interface LoggedEvent {
  type: string;
  ts: number;
  data: unknown;
}

const buffers = new Map<string, LoggedEvent[]>();

function recordEvent(type: string, data: unknown): void {
  const kioskId = (data as Record<string, unknown> | null)?.["kiosk_id"];
  // Not every event on the bus necessarily carries a kiosk_id (defensive —
  // all current emit sites do); skip rather than bucket under a fake key.
  if (typeof kioskId !== "string" || !kioskId) return;

  const arr = buffers.get(kioskId) ?? [];
  arr.push({
    type,
    ts: (data as Record<string, unknown>).ts as number | undefined ?? Date.now(),
    data,
  });
  if (arr.length > MAX_EVENTS_PER_KIOSK) arr.shift();
  buffers.set(kioskId, arr);
}

let installed = false;

/** Call once at server startup. Idempotent so an accidental double-import
 * doesn't double-subscribe and duplicate every logged event. */
export function installKioskEventLog(): void {
  if (installed) return;
  installed = true;
  for (const type of TRACKED_EVENTS) {
    kioskEventBus.on(type, (data: unknown) => recordEvent(type, data));
  }
}

/** Most-recent-last, capped to `limit`. Used by the feedback controller when
 * a KIOSK_PROBLEM report names a kioskId. */
export function getRecentKioskEvents(kioskId: string, limit = 15): LoggedEvent[] {
  const arr = buffers.get(kioskId) ?? [];
  return arr.slice(-limit);
}
