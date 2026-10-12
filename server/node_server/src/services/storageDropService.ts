import type { Server as SocketIOServer } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { emitOccupancyForLockerId } from "./lockerOccupancyService";
import { deriveLockerStatus } from "./pickupLaneService";

/**
 * E5.4 — drop a long-lead deposit into the LOWER compartment so the upper bay
 * is free for another hand-off.
 *
 * WHY THIS IS NOT `requestRelease`. Both move an item from the upper to the
 * lower compartment with the same actuator and the same `drop_item` command,
 * so reusing it is the obvious idea and it is wrong. `requestRelease` means
 * **"give this item back to its OWNER"**: it writes `releaseRequestedAt` /
 * `retrievalLockerId`, notifies the owner to come and collect, and sets a
 * `releaseReason`.
 *
 * The killer detail is `resolveFaceSubject`:
 *
 *     const awaitingRetrieval =
 *       rental.releaseRequestedAt != null && rental.retrievedAt == null;
 *     const isOwner = awaitingRetrieval || rental.status === "AWAITING_DEPOSIT";
 *
 * So writing `releaseRequestedAt` makes the OWNER the party who must
 * face-verify for that bay — which is correct for a rejected deposit and
 * catastrophic here. This drop happens because a deposit **passed**; the item
 * is on its way to the renter. Reusing the release path would lock the renter
 * out of their own rental and grant the owner a door onto it: exactly failure
 * mode F5, arrived at from the opposite direction.
 *
 * Hence a sibling path that shares the hardware command and shares nothing
 * else. It touches only the per-compartment columns.
 */

/**
 * Storage drops awaiting the Pi's acknowledgement, keyed by command id.
 *
 * Separate from `retrievalService`'s `pendingDrops` so the ack handler can
 * tell a storage drop from a release: they produce the same `drop_item`
 * command but must be recorded completely differently.
 */
const pendingStorageDrops = new Map<string, { rentalId: string; lockerId: string }>();

export function storageDropForCommand(
  commandId: string,
): { rentalId: string; lockerId: string } | undefined {
  return pendingStorageDrops.get(commandId);
}

/**
 * Command the actuator to move a rental's item down into storage.
 *
 * DRIVES HARDWARE. Only ever called for a long-lead deposit that has just been
 * approved by the full verification run — never on a fast-lane verdict, never
 * on a rejection, and never for a return.
 *
 * Returns false and does nothing if the bay's state does not match what we
 * believe, rather than stroking an actuator on a stale read.
 */
export async function dropToStorage(
  io: SocketIOServer,
  rentalId: string,
): Promise<boolean> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: {
      id: true,
      status: true,
      verificationStatus: true,
      depositLockerId: true,
      item: { select: { title: true } },
      renterId: true,
    },
  });

  if (!rental?.depositLockerId) {
    logger.warn(`Storage drop skipped for rental ${rentalId}: no deposit locker.`);
    return false;
  }

  // Re-check the preconditions against the database rather than trusting the
  // caller. An actuator stroke is not undoable.
  if (rental.status !== "DEPOSITED" || rental.verificationStatus !== "APPROVED") {
    logger.warn(
      `Storage drop refused for rental ${rentalId}: status=${rental.status} ` +
        `verificationStatus=${rental.verificationStatus}. Expected DEPOSITED/APPROVED.`,
    );
    return false;
  }

  const bay = await prisma.locker.findUnique({ where: { id: rental.depositLockerId } });
  if (!bay) {
    logger.error(`Storage drop for rental ${rentalId}: bay row missing.`);
    return false;
  }

  // The item must actually be in the UPPER compartment, and the lower one must
  // be empty. Dropping onto an occupied lower compartment would stack two
  // students' property — the invariant this whole design protects
  // (`LockerStatus.AWAITING_RETRIEVAL`'s comment).
  if (bay.topRentalId !== rentalId) {
    logger.warn(
      `Storage drop refused for rental ${rentalId}: bay ${bay.lockerNumber} upper ` +
        `compartment holds ${bay.topRentalId ?? "nothing"}.`,
    );
    return false;
  }
  if (bay.bottomStatus !== "AVAILABLE" || bay.bottomRentalId) {
    // Expected since 2026-10-12: a long-lead deposit may be assigned a bay whose
    // lower compartment is busy (it waits on top). Never drop onto an
    // un-retrieved item; runStorageDropSweep tries again when the lower frees.
    logger.warn(
      `Storage drop deferred for rental ${rentalId}: bay ${bay.lockerNumber} lower ` +
        `compartment is occupied by ${bay.bottomRentalId ?? "an unknown item"}; the item waits on top.`,
    );
    return false;
  }
  if (!bay.isOperational) {
    logger.warn(`Storage drop refused: bay ${bay.lockerNumber} is out of service.`);
    return false;
  }

  const commandId = `STOR${Date.now().toString(36).toUpperCase()}`;
  pendingStorageDrops.set(commandId, { rentalId, lockerId: bay.id });

  // Mark the bay in-motion BEFORE the command goes out, so nothing can be
  // assigned to either compartment while the actuator is travelling. Same
  // ordering rule as requestRelease.
  const moving = {
    topStatus: "RESERVED" as const,
    bottomStatus: "RESERVED" as const,
    isOperational: bay.isOperational,
  };
  await prisma.locker.update({
    where: { id: bay.id },
    data: {
      topStatus: "RESERVED",
      bottomStatus: "RESERVED",
      status: deriveLockerStatus(moving),
    },
  });
  await emitOccupancyForLockerId(io, bay.id);

  // No durations are sent: the Pi reads extend/retract seconds from its own
  // hand-calibrated kiosk_config.json, which is the only correct source (D-72).
  io.to(`kiosk:${bay.kioskId}`).emit("kiosk:command", {
    action: "drop_item",
    command_id: commandId,
    locker_id: parseInt(bay.lockerNumber, 10),
    rental_id: rentalId,
  });

  logger.info(
    `[E5.4] storage drop_item sent for rental ${rentalId}, bay ${bay.lockerNumber} ` +
      `(long-lead pick-up; freeing the upper compartment)`,
  );
  return true;
}

/**
 * The Pi acknowledged a storage drop. Only now is the item known to be in the
 * lower compartment, and only now may the upper compartment be offered to
 * someone else — the same rule `confirmRelease` applies, for the same reason.
 */
export async function confirmStorageDrop(
  io: SocketIOServer,
  commandId: string,
): Promise<void> {
  const pending = pendingStorageDrops.get(commandId);
  if (!pending) return;
  pendingStorageDrops.delete(commandId);

  const bay = await prisma.locker.findUnique({ where: { id: pending.lockerId } });
  if (!bay) return;

  const settled = {
    topStatus: "AVAILABLE" as const,
    bottomStatus: "OCCUPIED" as const,
    isOperational: bay.isOperational,
  };

  await prisma.locker.update({
    where: { id: bay.id },
    data: {
      // Upper compartment genuinely free now — this is the capacity win.
      topStatus: "AVAILABLE",
      topRentalId: null,
      bottomStatus: "OCCUPIED",
      bottomRentalId: pending.rentalId,
      bottomStoredAt: new Date(),
      status: deriveLockerStatus(settled),
      currentRentalId: pending.rentalId,
    },
  });
  await emitOccupancyForLockerId(io, bay.id);

  logger.info(
    `[E5.4] storage drop acknowledged for rental ${pending.rentalId}: bay ` +
      `${bay.lockerNumber} upper compartment released, item now behind bottom_door`,
  );
}

/**
 * Storage drops commanded and never acknowledged.
 *
 * Surfaced, never auto-retried, for the reason `findUnacknowledgedReleases`
 * gives: the item may be in either compartment, and a blind second stroke
 * could push a second item onto the first. A bay left with both compartments
 * RESERVED is this state, and it is deliberately unassignable until a human
 * resolves it.
 */
export function unacknowledgedStorageDrops(): Array<{
  commandId: string;
  rentalId: string;
  lockerId: string;
}> {
  return [...pendingStorageDrops.entries()].map(([commandId, v]) => ({
    commandId,
    ...v,
  }));
}
