/**
 * The last few hundred lines the kiosk logged, so the admin console can show
 * history instead of an empty box.
 *
 * Why this exists (2026-09-17): the user reported "the raspi logs don't reflect
 * here". Nothing was broken in the pipeline — the Pi emits `kiosk:log`, Node
 * publishes it to `kioskEventBus`, and `/admin/kiosks/events` streams it. But
 * the stream only carries what happens WHILE the page is open, and an idle
 * kiosk logs almost nothing, so "Waiting for Pi logs…" was literally true and
 * looked like a fault. There was no history anywhere to show.
 *
 * In-memory and capped on purpose: this is a convenience for a live operator,
 * not an audit trail (the real one is the Node log file and the AuditLog
 * table), and a restart SHOULD start it empty rather than replay stale lines
 * as if the kiosk had just said them.
 */

export interface KioskLogLine {
  kiosk_id: string;
  level: string;
  module: string;
  message: string;
  ts: number;
}

/** ~10 minutes of a chatty handover, and small enough to hand over in one
 *  response without paging. */
export const MAX_LINES = 300;

const lines: KioskLogLine[] = [];

export function recordKioskLog(line: KioskLogLine): void {
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

/**
 * Newest-last, which is the order the console appends in — so a client can
 * render the backlog and then keep appending live lines without re-sorting.
 * `limit` clamps to the buffer; a non-positive or absent limit means all.
 */
export function getKioskLogs(
  limit?: number,
  kioskId?: string,
  since?: number,
): KioskLogLine[] {
  // `since` is what lets the console POLL for new lines (D-86): the live event
  // stream never reaches the browser through the Cloudflare tunnel.
  const scoped = lines.filter(
    (l) =>
      (!kioskId || l.kiosk_id === kioskId) &&
      (since === undefined || l.ts > since),
  );
  if (!limit || limit <= 0 || limit >= scoped.length) return [...scoped];
  return scoped.slice(scoped.length - limit);
}

/** Test seam, and what the Clear button could eventually call. */
export function clearKioskLogs(): void {
  lines.length = 0;
}
