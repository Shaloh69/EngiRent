/**
 * The latest admin snapshot per locker, so the console can POLL for it.
 *
 * D-86 (2026-09-17), measured: the console's live event stream
 * (`/admin/kiosks/events`) delivers its first event in ~66ms on localhost and
 * NOTHING through the Cloudflare quick tunnel — not the opening event, not a
 * 2KB padding block, not a heartbeat, with or without compression, over 35s.
 * The kiosk captured, uploaded and relayed every snapshot correctly; the page
 * simply never heard. Ordinary request/response calls do get through the
 * tunnel, so the console now asks for the photo instead of waiting to be told.
 *
 * In-memory, one entry per locker, newest wins: a snapshot is a live look at a
 * bay, not a record, and the image files themselves are already stored.
 */

export interface AdminSnapshot {
  kioskId: string;
  lockerId: string;
  imageUrls: string[];
  ts: number;
}

const latest = new Map<string, AdminSnapshot>();

export function recordAdminSnapshot(raw: {
  kiosk_id?: string;
  locker_id?: number | string;
  image_urls?: unknown;
}): AdminSnapshot | null {
  const lockerId = raw?.locker_id === undefined ? "" : String(parseInt(String(raw.locker_id), 10));
  if (!lockerId || lockerId === "NaN") return null;
  const imageUrls = Array.isArray(raw.image_urls)
    ? raw.image_urls.filter((u): u is string => typeof u === "string")
    : [];
  // An empty list is still recorded: "the kiosk answered and captured nothing"
  // is exactly what the console must be able to say (D-85).
  const snap: AdminSnapshot = {
    kioskId: String(raw.kiosk_id ?? ""),
    lockerId,
    imageUrls,
    ts: Date.now(),
  };
  latest.set(lockerId, snap);
  return snap;
}

/** The newest snapshot for a locker, optionally only if taken after `since`. */
export function getLatestAdminSnapshot(lockerId: string, since?: number): AdminSnapshot | null {
  const snap = latest.get(String(parseInt(lockerId, 10)));
  if (!snap) return null;
  if (since !== undefined && snap.ts < since) return null;
  return snap;
}

/** Test seam only. */
export function _clearAdminSnapshots(): void {
  latest.clear();
}
