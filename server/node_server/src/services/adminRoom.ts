/**
 * The admin socket room — E2.2 / D-14.
 *
 * Two defects shared one cause. The four `admin:*` kiosk-telemetry events
 * were sent with `io.emit(...)`, a broadcast to every connected socket, so
 * kiosk ids, socket ids, status payloads and **error payloads** were pushed
 * to every student's phone. At the same time nothing consumed them, because
 * the admin console had no socket.io client at all — which is also the real
 * explanation for D-4's "nothing is real-time" on the console side.
 *
 * Fixing both is the same change: emit to a room, and have the console join
 * it. This module holds the parts worth testing, because `index.ts` boots the
 * HTTP and socket.io servers on import — the same constraint that made D-18's
 * fix extract `runMlVerification`.
 */

export const ADMIN_ROOM = "admin";

/** The subset of `socket.data` this decision depends on. */
export interface SocketIdentity {
  kind?: string;
  role?: string;
  userId?: string;
  kioskId?: string;
}

/**
 * Whether a socket may join the admin room and receive operational telemetry.
 *
 * Both halves of the check matter. `kind === "user"` is set by the io.use()
 * middleware **only after** a JWT verifies, so it is the part that proves the
 * role claim was not simply asserted by the client; the role comparison is
 * what limits it to staff. A kiosk authenticates with the shared secret and
 * carries no role at all, so it fails the second half regardless.
 *
 * REVIEWER is admitted alongside ADMIN because a reviewer works the
 * verification, moderation and feedback queues — precisely the queues this
 * room exists to keep live (`requireStaff`, middleware/auth.ts).
 */
export function canJoinAdminRoom(data: SocketIdentity | undefined | null): boolean {
  if (!data) return false;
  if (data.kind !== "user") return false;
  return data.role === "ADMIN" || data.role === "REVIEWER";
}

/** The minimum of socket.io's server surface this module needs. */
interface RoomEmitter {
  to(room: string): { emit(event: string, payload: unknown): unknown };
}

/**
 * Send an event to the admin room, and only to the admin room.
 *
 * Deliberately the single door for `admin:*` events: `io.emit` at a call site
 * is a one-character-looking difference that silently restores the broadcast,
 * and no test would fail. Tolerates a missing `io` so a controller that runs
 * without a socket server attached still completes its real work.
 */
export function notifyAdmins(
  io: RoomEmitter | undefined | null,
  event: string,
  payload: unknown,
): void {
  if (!io) return;
  io.to(ADMIN_ROOM).emit(event, payload);
}
