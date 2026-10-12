import type { Server } from "socket.io";
import prisma from "../config/database";
import logger from "../utils/logger";
import { setCompartment, recordCompartmentAfterCommit } from "./lockerCompartments";
import { emitOccupancyForLockerId } from "./lockerOccupancyService";
import { hasLiveGrantOnBay } from "./kioskBayAccessStore";
import { readRetrievalPolicy } from "./retrievalPolicy";
import { bayBusyWith, noteDropFinished, noteDropStarted } from "./retrievalService";
import { recordEvent, tellParty } from "./disputeEvents";

/**
 * Dispute v2, ruling 8 — the renter's OWN wrong item.
 *
 * It drops to the LOWER compartment (so the upper one is free for the next
 * hand-off) and the RENTER, not the owner, collects it with QR + face, at any
 * time, without paying first: it is their property. This replaces E3's "owner
 * collects it" (deployed 2026-10-10).
 *
 * Tracked on the Dispute row, not the rental's retrieval columns: a dispute has
 * two physical objects (this one, and the correct item still to come back for
 * the owner), and the rental's columns can only describe one. The compartment
 * itself still records the rental id, so every existing occupancy rule ("never
 * put a second item on top of an uncollected one") keeps protecting it.
 *
 * The kiosk target for collecting it is `wi:<disputeId>`, not the rental id.
 * The Pi passes the id through untouched (socket_client.py on_session_validate
 * -> initiate_rental_flow), and the server derives who may open it from the
 * Dispute row: the renter. Same trust shape as resolveFaceSubject: identity
 * from server state, never from the client.
 */

export const WRONG_ITEM_PREFIX = "wi:";

export function wrongItemTarget(disputeId: string): string {
  return `${WRONG_ITEM_PREFIX}${disputeId}`;
}

export function disputeIdFromTarget(target: string): string | null {
  return target.startsWith(WRONG_ITEM_PREFIX) ? target.slice(WRONG_ITEM_PREFIX.length) : null;
}

/** command_id -> disputeId, for the Pi's drop ack (same idea as retrievalService's pendingDrops). */
const pendingWrongItemDrops = new Map<string, string>();

export function wrongItemDropForCommand(commandId: string): string | undefined {
  return pendingWrongItemDrops.get(commandId);
}

const DISPUTE_FOR_ITEM = {
  select: {
    id: true,
    referenceNo: true,
    rentalId: true,
    renterId: true,
    ownerId: true,
    wrongItemLockerId: true,
    wrongItemDoor: true,
    wrongItemDropAt: true,
    wrongItemPlacedAt: true,
    wrongItemCollectedAt: true,
    rental: { select: { item: { select: { title: true } } } },
  },
} as const;

export interface DropOutcome {
  dropped: boolean;
  refusal?: string;
  lockerNumber?: string;
}

/**
 * Move the wrong item from the upper compartment down to the lower one, now,
 * at any hour (ruling 2026-10-10, kept by v2). DRIVES HARDWARE unattended, so
 * every guard that keeps a stroke safe applies: operational bay, automatic
 * release not switched off, no open door, no drop running, no live grant on
 * the bay, and an EMPTY lower compartment. Refuses rather than strokes on
 * anything unexpected; the item then stays collectable up top, and the
 * dispute sweep retries.
 */
export async function dropWrongItem(io: Server, disputeId: string): Promise<DropOutcome> {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId }, ...DISPUTE_FOR_ITEM });
  if (!d) return { dropped: false, refusal: "case not found" };
  if (!d.wrongItemLockerId || d.wrongItemCollectedAt) return { dropped: false, refusal: "no wrong item waiting" };
  if (d.wrongItemDropAt) return { dropped: false, refusal: "a drop is already in progress" };
  if (d.wrongItemDoor !== "main_door") return { dropped: false, refusal: "already in the lower compartment" };

  const bay = await prisma.locker.findUnique({ where: { id: d.wrongItemLockerId } });
  if (!bay) return { dropped: false, refusal: "bay not found" };
  if (!bay.isOperational || bay.status === "OUT_OF_SERVICE") {
    return { dropped: false, refusal: `bay ${bay.lockerNumber} is not operational` };
  }
  const configRow = await prisma.kioskConfig.findUnique({ where: { kioskId: bay.kioskId } });
  const policy = readRetrievalPolicy(configRow?.config);
  if (!policy.auto_release_enabled) {
    return { dropped: false, refusal: "automatic release is switched off for this kiosk" };
  }
  if (bayBusyWith(bay.kioskId, bay.lockerNumber) || hasLiveGrantOnBay(bay.kioskId, bay.lockerNumber)) {
    return { dropped: false, refusal: `bay ${bay.lockerNumber} has a live session, an open door or a drop running` };
  }
  if (bay.topRentalId !== d.rentalId) {
    return { dropped: false, refusal: "the upper compartment does not record this item; never stroke blind" };
  }
  if (bay.bottomStatus !== "AVAILABLE" || bay.bottomRentalId) {
    return { dropped: false, refusal: "lower compartment occupied; the item stays up top" };
  }

  const commandId = `DROP${Date.now().toString(36).toUpperCase()}`;
  pendingWrongItemDrops.set(commandId, disputeId);
  // Not collectable while it travels: the floor is moving. Set BEFORE the
  // command, cleared only by the Pi's ack (F3's ordering).
  await prisma.dispute.update({
    where: { id: disputeId },
    data: { wrongItemDropAt: new Date(), wrongItemPlacedAt: null },
  });
  await setCompartment(bay.id, "top", { status: "AWAITING_RETRIEVAL", rentalId: d.rentalId });
  await setCompartment(bay.id, "bottom", { status: "RESERVED", rentalId: d.rentalId });
  await emitOccupancyForLockerId(io, bay.id);
  noteDropStarted(bay.kioskId, bay.lockerNumber, d.rentalId);

  // No durations: the Pi reads its own hand-calibrated per-bay timings.
  io.to(`kiosk:${bay.kioskId}`).emit("kiosk:command", {
    action: "drop_item",
    command_id: commandId,
    locker_id: parseInt(bay.lockerNumber, 10),
    rental_id: d.rentalId,
  });
  await recordEvent(disputeId, {
    type: "WRONG_ITEM_DROP_SENT",
    actorRole: "SYSTEM",
    message: `Drop command ${commandId} sent: bay ${bay.lockerNumber}, upper to lower compartment.`,
  });
  logger.info(`[DISPUTE] wrong item of case ${d.referenceNo} drop sent, bay ${bay.lockerNumber} (${commandId})`);
  return { dropped: true, lockerNumber: bay.lockerNumber };
}

/** The Pi acknowledged a wrong-item drop: the item is in the lower compartment. */
export async function confirmWrongItemDrop(io: Server | undefined, commandId: string): Promise<void> {
  const disputeId = pendingWrongItemDrops.get(commandId);
  if (!disputeId) return;
  pendingWrongItemDrops.delete(commandId);
  const d = await prisma.dispute.findUnique({ where: { id: disputeId }, ...DISPUTE_FOR_ITEM });
  if (!d || !d.wrongItemLockerId || !d.wrongItemDropAt) return;
  const bay = await prisma.locker.findUnique({ where: { id: d.wrongItemLockerId } });
  if (!bay) return;

  await setCompartment(bay.id, "top", { status: "AVAILABLE", rentalId: null });
  await setCompartment(bay.id, "bottom", { status: "AWAITING_RETRIEVAL", rentalId: d.rentalId });
  await prisma.dispute.update({
    where: { id: disputeId },
    data: { wrongItemDoor: "bottom_door", wrongItemDropAt: null, wrongItemPlacedAt: new Date() },
  });
  noteDropFinished(bay.kioskId, bay.lockerNumber);
  if (io) await emitOccupancyForLockerId(io, bay.id);

  await tellParty(
    io,
    d,
    "RENTER",
    "Your item is ready to collect",
    `The item you left for case ${d.referenceNo} is now behind the LOWER door of locker ${bay.lockerNumber}. ` +
      `Collect it at any time: open the case in the app, tap "Collect my item" and scan the kiosk QR code. ` +
      `You do not need to pay first.`,
    { type: "WRONG_ITEM_PLACED" },
  );
  logger.info(`[DISPUTE] wrong item of case ${d.referenceNo} confirmed in the lower compartment of bay ${bay.lockerNumber}`);
}

/**
 * The renter opened the door to take their wrong item ("Open Kiosk Now").
 * Committed on the real open, like a claim (D-94) and a retrieval (E6.U).
 * Frees ONLY that compartment. Idempotent: a re-open does nothing further.
 */
export async function completeWrongItemCollection(
  io: Server,
  disputeId: string,
  door: "main_door" | "bottom_door",
): Promise<void> {
  const marked = await prisma.dispute.updateMany({
    where: { id: disputeId, wrongItemCollectedAt: null, wrongItemPlacedAt: { not: null } },
    data: { wrongItemCollectedAt: new Date() },
  });
  if (marked.count === 0) return;
  const d = await prisma.dispute.findUnique({ where: { id: disputeId }, ...DISPUTE_FOR_ITEM });
  if (!d?.wrongItemLockerId) return;

  await recordCompartmentAfterCommit(d.wrongItemLockerId, door === "main_door" ? "top" : "bottom", {
    status: "AVAILABLE",
    rentalId: null,
  });
  await emitOccupancyForLockerId(io, d.wrongItemLockerId);
  await recordEvent(disputeId, {
    type: "WRONG_ITEM_COLLECTED",
    actorRole: "RENTER",
    actorId: d.renterId,
    message: `The renter opened the ${door === "bottom_door" ? "lower" : "upper"} door and collected their own item.`,
  });
  io.to(`user:${d.renterId}`).emit("dispute:update", { disputeId, rentalId: d.rentalId });
  logger.info(`[DISPUTE] case ${d.referenceNo}: renter collected their wrong item`);
}

/**
 * The bays whose UPPER compartment still holds an uncollected wrong item of this
 * rental, so a return is never assigned on top of one.
 *
 * Only the upper compartment counts (user ruling 2026-10-12). A wrong item that
 * is already in the lower compartment leaves the upper door free, and a correct
 * item on top of one below is the normal two-compartment case. This used to
 * exclude the whole bay: on 2026-10-12 the return skipped bay 1 although its
 * upper door was free, because the wrong item had been dropped below before
 * Dispute v2 (that migrated case carries no drop time to tell us so).
 */
export async function baysHoldingWrongItems(rentalId: string): Promise<string[]> {
  const rows = await prisma.dispute.findMany({
    where: { rentalId, wrongItemLockerId: { not: null }, wrongItemCollectedAt: null },
    select: { wrongItemLockerId: true },
  });
  const ids = rows.map((r) => r.wrongItemLockerId as string);
  if (ids.length === 0) return [];
  const bays = await prisma.locker.findMany({
    where: { id: { in: ids }, topRentalId: rentalId },
    select: { id: true },
  });
  return bays.map((b) => b.id);
}

/** F3 for wrong items: drops sent and never acknowledged. Surfaced, never auto-retried. */
export async function findUnacknowledgedWrongItemDrops(staleAfterSeconds = 180) {
  const cutoff = new Date(Date.now() - staleAfterSeconds * 1000);
  return prisma.dispute.findMany({
    where: { wrongItemDropAt: { not: null, lt: cutoff }, wrongItemPlacedAt: null, wrongItemCollectedAt: null },
    select: { id: true, referenceNo: true, wrongItemLockerId: true, wrongItemDropAt: true },
  });
}
