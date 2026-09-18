import type { LockerStatus, Prisma } from "@prisma/client";
import prisma from "../config/database";
import { deriveLockerStatus } from "./pickupLaneService";

/**
 * E5 — THE ONLY WAY A BAY'S OCCUPANCY SHOULD CHANGE.
 *
 * Why this exists: E5 split a bay into an upper and a lower compartment and
 * taught locker ASSIGNMENT to read the per-compartment columns. But eight
 * older call sites still wrote only the legacy whole-bay `status`. Found
 * 2026-09-18 while fixing an unrelated edge case, before the second physical
 * test. Traced through one normal rental:
 *
 *   assign           -> topStatus RESERVED
 *   deposit accepted -> status OCCUPIED          (top untouched)
 *   claim            -> top freed
 *   return assigned  -> topStatus RESERVED
 *   release to owner -> status AWAITING_RETRIEVAL (top STILL RESERVED)
 *   owner collects   -> status AVAILABLE          (top STILL RESERVED)
 *
 * After ONE complete lifecycle the bay read `AVAILABLE` everywhere a human
 * looked, while `canAcceptDeposit` saw a RESERVED upper compartment and
 * refused it forever. Every rental would have silently killed a bay; three
 * full cycles and the whole bank reads "no locker available" with four empty
 * lockers standing there.
 *
 * The cause was not any one site but the arrangement: two representations of
 * the same fact, written independently. So every write now goes through here,
 * and the whole-bay `status` is never written directly again — it is always
 * DERIVED from both compartments (`deriveLockerStatus`), which also stops a
 * freed upper compartment from reporting a bay as AVAILABLE while the lower
 * one still holds someone's stored item.
 */

export type Compartment = "top" | "bottom";

type Tx = Prisma.TransactionClient;

interface CompartmentChange {
  status: LockerStatus;
  rentalId: string | null;
}

/**
 * Set one compartment and re-derive everything else from the result.
 *
 * Read-modify-write inside a transaction, because the new whole-bay status
 * depends on the OTHER compartment's current value. Two writers racing
 * without it could each derive from a stale sibling and leave the pair
 * inconsistent — the exact drift this module exists to end.
 */
export async function setCompartment(
  lockerId: string,
  side: Compartment,
  change: CompartmentChange,
  extra: Prisma.LockerUpdateInput = {},
  client?: Tx,
): Promise<void> {
  const run = async (tx: Tx) => {
    const bay = await tx.locker.findUnique({ where: { id: lockerId } });
    if (!bay) throw new Error(`setCompartment: locker ${lockerId} not found`);

    const top =
      side === "top"
        ? { status: change.status, rentalId: change.rentalId }
        : { status: bay.topStatus, rentalId: bay.topRentalId };
    const bottom =
      side === "bottom"
        ? { status: change.status, rentalId: change.rentalId }
        : { status: bay.bottomStatus, rentalId: bay.bottomRentalId };

    await tx.locker.update({
      where: { id: lockerId },
      data: {
        ...extra,
        topStatus: top.status,
        topRentalId: top.rentalId,
        bottomStatus: bottom.status,
        bottomRentalId: bottom.rentalId,
        // Emptying the lower compartment clears its storage stamp; the stamp
        // exists only to describe an item that is actually down there.
        ...(side === "bottom" && change.status === "AVAILABLE"
          ? { bottomStoredAt: null }
          : {}),
        status: deriveLockerStatus({
          topStatus: top.status,
          bottomStatus: bottom.status,
          isOperational: bay.isOperational,
        }),
        // The legacy single pointer: the upper item if any, else the lower.
        currentRentalId: top.rentalId ?? bottom.rentalId ?? null,
      },
    });
  };

  if (client) return run(client);
  await prisma.$transaction(run);
}

/**
 * Declare a whole bay empty — both compartments.
 *
 * Only for a deliberate, whole-bay release (an admin or owner "release this
 * locker" action), where the person is asserting nothing is inside. Never use
 * this to free one item: it would also wipe the other compartment.
 */
export async function clearBay(lockerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const bay = await tx.locker.findUnique({ where: { id: lockerId } });
    if (!bay) throw new Error(`clearBay: locker ${lockerId} not found`);
    await tx.locker.update({
      where: { id: lockerId },
      data: {
        topStatus: "AVAILABLE",
        topRentalId: null,
        bottomStatus: "AVAILABLE",
        bottomRentalId: null,
        bottomStoredAt: null,
        status: deriveLockerStatus({
          topStatus: "AVAILABLE",
          bottomStatus: "AVAILABLE",
          isOperational: bay.isOperational,
        }),
        currentRentalId: null,
      },
    });
  });
}

/** Which compartment currently holds a given rental's item, if either. */
export async function compartmentHolding(
  lockerId: string,
  rentalId: string,
): Promise<Compartment | null> {
  const bay = await prisma.locker.findUnique({
    where: { id: lockerId },
    select: { topRentalId: true, bottomRentalId: true },
  });
  if (!bay) return null;
  if (bay.topRentalId === rentalId) return "top";
  if (bay.bottomRentalId === rentalId) return "bottom";
  return null;
}
