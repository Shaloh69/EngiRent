/**
 * Who may drive a bay from their phone, and for how long.
 *
 * The QR session (`kioskSessionStore`) is consumed the moment a face verifies,
 * because it exists to answer one question — "did this person just scan THIS
 * kiosk?" — and a single-use answer is the point. But the physical steps that
 * follow are not instant: the door has to be opened, an item put in, and on a
 * RETRY verdict all of that happens again. Before 2026-09-14 the server simply
 * opened the door itself and fired a camera 20s later on a timer; a student who
 * was still reading their phone missed the window, and a retry re-opened the
 * door with nothing behind it (D-78).
 *
 * So the door is now opened by a tap ("Open Kiosk Now") and the photos are
 * taken by a tap ("Item is placed"), and this store is what makes those taps
 * safe: a grant naming exactly one rental, one user, one kiosk, one bay and one
 * door, with a short life and a hard cap on how many times each may fire.
 *
 * Deliberately NOT a relaxation of the trust boundary (`Implemented.md` §6):
 * a grant can only be created server-side by a face verification that already
 * passed, it never comes from client input, and every field the hardware acts
 * on is read from here rather than from the request.
 *
 * In-memory on purpose, like `kioskSessionStore`: one process, one kiosk, and a
 * restart SHOULD drop every grant — a door must never open because of something
 * a previous process believed.
 */

export type BayAction = "deposit" | "claim" | "return" | "retrieve";

export interface BayAccess {
  rentalId: string;
  userId: string;
  kioskId: string;
  action: BayAction;
  lockerNumber: string;
  door: "main_door" | "bottom_door";
  createdAt: number;
  expiresAt: number;
  opens: number;
  captures: number;
}

/**
 * Long next to the QR session's 120s, because this covers a person physically
 * placing an item and, on a retry, doing it again. Short next to "forever":
 * an unattended kiosk must not still be openable from a phone in a pocket ten
 * minutes later.
 */
export const BAY_ACCESS_TTL_MS = 6 * 60_000;

/** ML allows 10 attempts; the caps sit above that so a legitimate retry loop is
 *  never the thing that stops, while a stuck client still cannot hammer the
 *  hardware indefinitely. */
export const MAX_OPENS = 12;
export const MAX_CAPTURES = 12;

const grants = new Map<string, BayAccess>();

export function isExpired(grant: BayAccess, now: number = Date.now()): boolean {
  return now >= grant.expiresAt;
}

export function grantBayAccess(params: {
  rentalId: string;
  userId: string;
  kioskId: string;
  action: BayAction;
  lockerNumber: string;
  door: "main_door" | "bottom_door";
}): BayAccess {
  const now = Date.now();
  const grant: BayAccess = {
    ...params,
    createdAt: now,
    expiresAt: now + BAY_ACCESS_TTL_MS,
    opens: 0,
    captures: 0,
  };
  // A fresh face verification replaces whatever went before: re-scanning is
  // how a person recovers, and the new grant is the newer proof.
  grants.set(params.rentalId, grant);
  return grant;
}

export function getBayAccess(rentalId: string): BayAccess | undefined {
  const grant = grants.get(rentalId);
  if (!grant) return undefined;
  if (isExpired(grant)) {
    grants.delete(rentalId);
    return undefined;
  }
  return grant;
}

export function revokeBayAccess(rentalId: string): void {
  grants.delete(rentalId);
}

/**
 * Is anyone else currently holding this bay? — F2's `hasLiveKioskSession`
 * input (D-96, §12).
 *
 * **This is the grant store and not the session store, and that is a
 * correction to the spec rather than a shortcut.** `LIFECYCLE-PROCESS-MAP.md`
 * §12 said to feed the flag "from the session store", but `KioskSession`
 * holds no bay at all — at `kiosk:flow_start` no bay has been assigned yet,
 * so it cannot answer a per-bay question. A `BayAccess` grant can: it names
 * the kiosk, the bay and the door, and it means a specific person has been
 * told that bay is theirs and may be standing in front of it.
 *
 * `exceptRentalId` exists for one reason. A release is triggered *by* a
 * rental — most often R2, the moment a return passes — and that rental's own
 * grant is usually still live, because the person finished with the bay
 * seconds ago. Counting it would refuse essentially every return-triggered
 * release, and nothing retries an R2 refusal, so the owner would simply never
 * be told their item was ready. Someone *else's* grant is the dangerous one,
 * and that is what this counts. The "hand may be inside right now" case is
 * covered separately and without exception by `isDoorOpen`.
 */
export function hasLiveGrantOnBay(
  kioskId: string,
  lockerNumber: string,
  exceptRentalId?: string,
): boolean {
  const now = Date.now();
  for (const grant of grants.values()) {
    if (grant.kioskId !== kioskId) continue;
    if (grant.lockerNumber !== lockerNumber) continue;
    if (exceptRentalId && grant.rentalId === exceptRentalId) continue;
    if (isExpired(grant, now)) continue;
    return true;
  }
  return false;
}

/** Which live grant holds this bay, if any — for messages and logs that need
 *  to say more than yes/no. */
export function grantHoldingBay(
  kioskId: string,
  lockerNumber: string,
  exceptRentalId?: string,
): BayAccess | undefined {
  const now = Date.now();
  for (const grant of grants.values()) {
    if (grant.kioskId !== kioskId) continue;
    if (grant.lockerNumber !== lockerNumber) continue;
    if (exceptRentalId && grant.rentalId === exceptRentalId) continue;
    if (isExpired(grant, now)) continue;
    return grant;
  }
  return undefined;
}

/** Returns the updated grant, or a refusal reason. Counting happens here so a
 *  caller cannot forget to count. */
export function noteOpen(
  rentalId: string,
): { ok: true; grant: BayAccess } | { ok: false; reason: string } {
  const grant = getBayAccess(rentalId);
  if (!grant) return { ok: false, reason: "expired" };
  if (grant.opens >= MAX_OPENS) return { ok: false, reason: "too_many_opens" };
  grant.opens += 1;
  return { ok: true, grant };
}

export function noteCapture(
  rentalId: string,
): { ok: true; grant: BayAccess } | { ok: false; reason: string } {
  const grant = getBayAccess(rentalId);
  if (!grant) return { ok: false, reason: "expired" };
  if (grant.captures >= MAX_CAPTURES) {
    return { ok: false, reason: "too_many_captures" };
  }
  grant.captures += 1;
  return { ok: true, grant };
}

/** Test seam only. */
export function _clearAllBayAccess(): void {
  grants.clear();
}

// Expired grants are dropped on read, but a grant nobody reads again would sit
// in memory until the process ends. Same shape as kioskSessionStore's sweep.
const sweep = setInterval(
  () => {
    const now = Date.now();
    for (const [rentalId, grant] of grants) {
      if (now >= grant.expiresAt) grants.delete(rentalId);
    }
  },
  60_000,
);
sweep.unref();
