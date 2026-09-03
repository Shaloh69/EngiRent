/**
 * Kiosk session store — the binding that stops `/kiosk/verify-face` from
 * being replayed away from the kiosk (found 2026-09-03, tracing the QR→face
 * flow end to end).
 *
 * A session is opened here only when the *kiosk itself* has already
 * validated the scanned QR token (its own signature + 90s TTL, checked in
 * `validate_qr_token_internal` on the Pi) and told Node so via
 * `kiosk:flow_start`. That is the one point in the whole flow where "a real
 * person is standing at this physical kiosk right now" is actually true —
 * everything downstream trusts *this* record, never a client-supplied token.
 *
 * Without it, `/kiosk/verify-face` had no way to know a scan had genuinely
 * just happened: it parsed `kioskId` out of whatever token string the app
 * sent, with no signature or expiry check on that string at the Node layer.
 * A token captured once could be replayed indefinitely, from anywhere, to
 * open a locker with nobody at the kiosk.
 *
 * In-memory and single-process by design — same tier as `kioskEventBus` and
 * the QR token itself (server.py's `_active_qr_token` is equally
 * in-process). A rental only ever has one open session at a time, and a
 * restart simply requires everyone to re-scan, which is an acceptable cost
 * for a same-process cache that never needs to survive a deploy.
 */

import logger from "../utils/logger";

export interface KioskSession {
  kioskId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

/** Generous relative to the QR's own 90s TTL — the token was already valid
 *  when the kiosk opened this session, so the clock here is really just
 *  "how long should a phone get to take a selfie and upload it", not a
 *  second QR-expiry check. */
const SESSION_TTL_MS = 120_000;

/** After this many failed match attempts within one session, force a
 *  re-scan rather than let the app hammer the ML comparator indefinitely
 *  against the same open session. */
const MAX_ATTEMPTS = 4;

const sessions = new Map<string, KioskSession>();

function isExpired(session: KioskSession): boolean {
  return Date.now() >= session.expiresAt;
}

/** Called once, by the `kiosk:flow_start` handler, right after the kiosk has
 *  confirmed the scanned token was genuine. */
export function openKioskSession(
  rentalId: string,
  kioskId: string,
  userId: string,
): void {
  const now = Date.now();
  sessions.set(rentalId, {
    kioskId,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    attempts: 0,
  });
}

/** Returns the session only if it exists and hasn't expired — an expired
 *  entry is treated as absent (and swept) rather than returned stale. */
export function getKioskSession(rentalId: string): KioskSession | undefined {
  const session = sessions.get(rentalId);
  if (!session) return undefined;
  if (isExpired(session)) {
    sessions.delete(rentalId);
    return undefined;
  }
  return session;
}

/** A face comparison came back verified=true. Single-use: the same session
 *  cannot open a second door. */
export function consumeKioskSession(rentalId: string): void {
  sessions.delete(rentalId);
}

/** A face comparison came back verified=false. Returns whether the session
 *  is now exhausted (caller must re-scan the kiosk QR) or can still retry. */
export function recordFailedFaceAttempt(rentalId: string): {
  exhausted: boolean;
  attemptsRemaining: number;
} {
  const session = sessions.get(rentalId);
  if (!session) return { exhausted: true, attemptsRemaining: 0 };

  session.attempts += 1;
  const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - session.attempts);

  if (session.attempts >= MAX_ATTEMPTS) {
    sessions.delete(rentalId);
    return { exhausted: true, attemptsRemaining: 0 };
  }
  return { exhausted: false, attemptsRemaining };
}

// Periodic sweep so an abandoned scan (kiosk opened a session, nobody ever
// completed it) doesn't sit in memory past its own TTL.
setInterval(() => {
  const now = Date.now();
  let swept = 0;
  for (const [rentalId, session] of sessions) {
    if (now >= session.expiresAt) {
      sessions.delete(rentalId);
      swept += 1;
    }
  }
  if (swept > 0) {
    logger.debug(`[KIOSK-SESSION]  Swept ${swept} expired kiosk session(s)`);
  }
}, 60_000).unref();
