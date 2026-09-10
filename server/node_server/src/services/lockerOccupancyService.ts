import type { Server as SocketIOServer } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";

/**
 * D-53 — the kiosk's half of "which bays are free".
 *
 * The kiosk UI used to answer that from DOOR LOCK STATE, which is not
 * occupancy. A door reads "unlocked" only while it is physically standing
 * open, for the few seconds of a handover, so counting bays with no open door
 * as "empty and ready for a drop-off" produced ~4 of 4 essentially always,
 * whatever the bays actually held. The kiosk half of the fix (a pure data
 * relay into `_ui_state["occupancy"]`, plus a UI that renders absent status as
 * UNKNOWN rather than as free) shipped first; this is the server half that
 * gives it something to render.
 *
 * `Locker.status` is the canonical model and this service is the only thing
 * that pushes it to a kiosk. It is a *data* path end to end: nothing here
 * touches a solenoid, an actuator or a camera, which is the boundary
 * `CLAUDE.md` draws around UI work.
 */

/**
 * The room name is an EXACT string match, and that has already cost this
 * project once: `Locker.kioskId` read `"kiosk-1"` while the real deployed
 * kiosk registers itself as `"KIOSK-001"`, so every command went to a room
 * nobody was in while the API reported success (fixed in the DB 2026-09-03;
 * see memory.md). An emit into an empty room throws nothing and logs nothing
 * by default — which is precisely why `emitLockerOccupancy` below warns when
 * a kiosk id has no lockers behind it.
 */
const kioskRoom = (kioskId: string) => `kiosk:${kioskId}`;

/**
 * Per-bay status keyed by `lockerNumber`, which is the key the kiosk UI
 * indexes (`LockersScreen.tsx` iterates `["1","2","3","4"]`). Values are the
 * `LockerStatus` enum spelled exactly as Prisma emits it, because the UI
 * compares against those strings literally.
 */
export type OccupancyMap = Record<string, string>;

/**
 * Reads the canonical status of every bay on one kiosk.
 *
 * **`isOperational: false` is folded into `OUT_OF_SERVICE`.** The two fields
 * are separate in the schema, but the server's own assignment queries all
 * require `isOperational: true` (`getAvailableLockers`, `assignLockerAndOpen`,
 * `depositItem`) — so a bay that is `AVAILABLE` but not operational is one the
 * server will never hand out. Reporting it to a student as "Free" would be a
 * fresh instance of exactly the lie D-53 exists to remove, so the flag is
 * resolved here rather than being pushed to the UI as a second field it would
 * have to remember to combine.
 */
export async function buildOccupancyMap(kioskId: string): Promise<OccupancyMap> {
  const lockers = await prisma.locker.findMany({
    where: { kioskId },
    select: { lockerNumber: true, status: true, isOperational: true },
    orderBy: { lockerNumber: "asc" },
  });

  const map: OccupancyMap = {};
  for (const l of lockers) {
    map[l.lockerNumber] = l.isOperational ? l.status : "OUT_OF_SERVICE";
  }
  return map;
}

/**
 * Pushes the current occupancy of one kiosk's bays to that kiosk.
 *
 * **Never throws.** Every call site sits immediately after a rental or locker
 * transition that has already committed; a failed status push must not turn a
 * completed deposit into a 500. Same reasoning as
 * `recomputeItemAvailability` — this is a display value, and a moment of
 * staleness is a better failure than an aborted flow.
 */
export async function emitLockerOccupancy(
  io: SocketIOServer | undefined | null,
  kioskId: string | undefined | null,
): Promise<void> {
  if (!io || !kioskId) return;
  try {
    const lockers = await buildOccupancyMap(kioskId);

    if (Object.keys(lockers).length === 0) {
      // The empty-room trap, made visible. memory.md's own note on the
      // 2026-09-03 mismatch asked for exactly this check: "confirm at least
      // one live kiosk socket is actually joined to every kioskId a Locker
      // row references". A kiosk that registers under an id no Locker row
      // carries will otherwise sit on "Unknown" forever while this side
      // reports success.
      logger.warn(
        `kiosk:occupancy — no Locker rows for kioskId "${kioskId}". ` +
          `The kiosk will render every bay as UNKNOWN. Check that the ` +
          `registering kiosk's KIOSK_ID matches Locker.kioskId exactly.`,
      );
      return;
    }

    io.to(kioskRoom(kioskId)).emit("kiosk:occupancy", {
      kiosk_id: kioskId,
      lockers,
      ts: Date.now(),
    });
    logger.info(
      `📤 [PI-OCCUPANCY] ${kioskId} → ${JSON.stringify(lockers)}`,
    );
  } catch (err) {
    logger.error(`Failed to emit kiosk:occupancy for ${kioskId}:`, err);
  }
}

/**
 * Same, for the call sites that hold a locker's primary key but not its kiosk
 * (the claim flow works from `rental.depositLockerId`). Resolves the kiosk
 * first so no call site has to remember that occupancy is per-kiosk, not
 * per-locker: one bay changing means the whole panel's count changes.
 */
export async function emitOccupancyForLockerId(
  io: SocketIOServer | undefined | null,
  lockerId: string | undefined | null,
): Promise<void> {
  if (!io || !lockerId) return;
  try {
    const locker = await prisma.locker.findUnique({
      where: { id: lockerId },
      select: { kioskId: true },
    });
    if (!locker) return;
    await emitLockerOccupancy(io, locker.kioskId);
  } catch (err) {
    logger.error(`Failed to resolve kiosk for locker ${lockerId}:`, err);
  }
}
