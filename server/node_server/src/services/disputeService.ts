import type { Server } from "socket.io";
import type { Dispute } from "@prisma/client";
import prisma from "../config/database";
import logger from "../utils/logger";
import { notifyAdmins } from "./adminRoom";
import { compartmentHolding, setCompartment } from "./lockerCompartments";
import { emitOccupancyForLockerId } from "./lockerOccupancyService";
import { recomputeItemAvailability } from "./itemAvailabilityService";
import { amountOwed, computeFees, deadlineHoursFor, FeeStatement, reminderStageDue } from "./disputeFees";
import { plainVerdict, PlainVerdict } from "./aiVerdictSummary";
import { recordEvent, tellParty, withReference } from "./disputeEvents";
import {
  MessageContext,
  ownerNotice,
  ownerNoticeTitle,
  overturnedRenterText,
  reminderText,
  reminderTitle,
  renterPrompt,
  renterPromptTitle,
  resolvedRenterText,
} from "./disputeMessages";
import { dropWrongItem, findUnacknowledgedWrongItemDrops } from "./disputeWrongItemService";

/**
 * Dispute System v2 — the case lifecycle (user rulings 2026-10-11, PROGRESS.md
 * "PRE-/clear HANDOFF #4"). Only an admin's Reject opens a case (ruling 2).
 */

export const ACTIVE_DISPUTE_STATUSES = ["OPEN", "PAYMENT_PENDING", "PAID", "RETURN_REVIEW"] as const;
/** The statuses in which the renter still has something to do. */
export const RENTER_ACTION_STATUSES = ["OPEN", "PAYMENT_PENDING", "PAID"] as const;

export interface DisputeMoney {
  /** The cap in force now (see feeCapFor). */
  capSource?: "REPLACEMENT_VALUE" | "FALLBACK";
  statement: FeeStatement;
  paid: number;
  pending: number;
  lateFeeCredit: number;
  /** Owed right now, before any pending payment is confirmed. */
  owed: number;
  /** Owed once the pending payment is confirmed. */
  owedAfterPending: number;
}

/** User ruling 2026-10-11: until the owner states a replacement value, the cap
 *  is the larger of the deposit and 30 days of the daily price. */
export const FALLBACK_CAP_DAYS = 30;

/**
 * The cap that applies to a case RIGHT NOW (user ruling 2026-10-11): the item's
 * replacement value as soon as the owner has entered one, otherwise the larger
 * of the security deposit and 30 days of the daily price. Either way, less what
 * was already paid on earlier cases of the same rental, so the cumulative total
 * never passes it. Read live, so an owner filling the value in updates open cases.
 * `Dispute.feeCap` keeps the cap as it stood when the case opened, for the record.
 */
export async function feeCapFor(d: Dispute): Promise<{ cap: number; source: "REPLACEMENT_VALUE" | "FALLBACK" }> {
  const rental = await prisma.rental.findUnique({
    where: { id: d.rentalId },
    select: { securityDeposit: true, item: { select: { replacementValue: true } } },
  });
  const paidOnOtherCases = (
    await prisma.transaction.findMany({
      where: { rentalId: d.rentalId, type: "DISPUTE_FEE", status: "COMPLETED", disputeId: { not: d.id } },
      select: { amount: true },
    })
  ).reduce((s, t) => s + t.amount, 0);
  const replacement = rental?.item.replacementValue ?? null;
  const base =
    replacement != null ? replacement : Math.max(rental?.securityDeposit ?? 0, d.feeBase * FALLBACK_CAP_DAYS);
  return {
    cap: Math.max(0, Math.round((base - paidOnOtherCases) * 100) / 100),
    source: replacement != null ? "REPLACEMENT_VALUE" : "FALLBACK",
  };
}

export async function disputeMoney(d: Dispute, now = new Date()): Promise<DisputeMoney & { capSource: "REPLACEMENT_VALUE" | "FALLBACK" }> {
  const capInfo = await feeCapFor(d);
  const [fees, lateFees] = await Promise.all([
    prisma.transaction.findMany({ where: { disputeId: d.id, type: "DISPUTE_FEE" } }),
    d.offense === 1
      ? prisma.transaction.findMany({ where: { rentalId: d.rentalId, type: "LATE_FEE", status: "COMPLETED" } })
      : Promise.resolve([]),
  ]);
  const paid = fees.filter((t) => t.status === "COMPLETED").reduce((s, t) => s + t.amount, 0);
  const pending = fees
    .filter((t) => t.status === "PENDING" || t.status === "PROCESSING")
    .reduce((s, t) => s + t.amount, 0);
  const lateFeeCredit = lateFees.reduce((s, t) => s + t.amount, 0);
  const statement = computeFees(
    {
      offense: d.offense,
      base: d.feeBase,
      cap: capInfo.cap,
      startAt: d.feeStartAt,
      frozenSeconds: d.frozenSeconds,
      frozenAt: d.feesFrozenAt,
    },
    now,
  );
  return {
    capSource: capInfo.source,
    statement,
    paid,
    pending,
    lateFeeCredit,
    owed: amountOwed(statement.accrued, paid, lateFeeCredit),
    owedAfterPending: amountOwed(statement.accrued, paid + pending, lateFeeCredit),
  };
}

/** Is this user restricted, and why? Server-side truth; the app only mirrors it. */
export async function getRestriction(userId: string): Promise<{
  restricted: boolean;
  reason: string | null;
  disputeId: string | null;
  suspendedUntilReview: boolean;
}> {
  const [active, user] = await Promise.all([
    prisma.dispute.findFirst({
      where: { renterId: userId, status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
      orderBy: { openedAt: "desc" },
      select: { id: true, referenceNo: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { restrictedUntilReviewAt: true } }),
  ]);
  const suspended = Boolean(user?.restrictedUntilReviewAt);
  if (!active && !suspended) return { restricted: false, reason: null, disputeId: null, suspendedUntilReview: false };
  return {
    restricted: true,
    reason: active
      ? `Your account is restricted while dispute ${active.referenceNo} is open.`
      : "Your account is suspended until an admin reviews it after a second wrong item.",
    disputeId: active?.id ?? null,
    suspendedUntilReview: suspended,
  };
}

async function verdictFor(verificationId: string | null | undefined, itemTitle: string): Promise<PlainVerdict | null> {
  if (!verificationId) return null;
  const v = await prisma.verification.findUnique({ where: { id: verificationId } });
  if (!v) return null;
  return plainVerdict({
    itemTitle,
    score: v.confidenceScore,
    mlEvidence: v.mlEvidence as never,
    deepReviewDetails: v.deepReviewDetails as never,
    deepReviewScore: v.deepReviewScore,
    unavailable: v.unavailable,
    unavailableReason: v.unavailableReason,
    adminDecision: "REJECTED",
  });
}

export async function messageContext(d: Dispute, now = new Date()): Promise<MessageContext> {
  const rental = await prisma.rental.findUnique({
    where: { id: d.rentalId },
    select: { returnedAt: true, item: { select: { title: true } } },
  });
  const bay = d.wrongItemLockerId
    ? await prisma.locker.findUnique({ where: { id: d.wrongItemLockerId }, select: { lockerNumber: true } })
    : null;
  const money = await disputeMoney(d, now);
  return {
    reference: d.referenceNo,
    itemTitle: rental?.item.title ?? "the item",
    offense: d.offense,
    returnedAt: rental?.returnedAt ?? null,
    lockerNumber: bay?.lockerNumber ?? null,
    wrongItemDoor: d.wrongItemDoor,
    deadlineAt: d.deadlineAt,
    deadlineHours: d.deadlineHours,
    feeBase: d.feeBase,
    feeCap: (await feeCapFor(d)).cap,
    feeCapSource: money.capSource ?? "FALLBACK",
    feeStartAt: d.feeStartAt,
    owed: money.owed,
    aiHeadline: d.aiSummary ? d.aiSummary.split("\n")[0] : null,
  };
}

/**
 * Ruling 2: an admin clicked Reject on a return. Opens the case, restricts the
 * renter, hands the wrong item to the RENTER (and drops it to the lower
 * compartment), takes the owner out of it, and tells everyone, in words that
 * are logged on the case.
 */
export async function openDispute(
  io: Server | undefined,
  p: {
    rentalId: string;
    verificationId?: string | null;
    adminId?: string | null;
    deadlineHours?: number | null;
    now?: Date;
    /** Migration of a pre-v2 case: fees start at the migration, not the due date. */
    feesStartNow?: boolean;
    note?: string;
  },
): Promise<Dispute> {
  const now = p.now ?? new Date();
  const rental = await prisma.rental.findUnique({
    where: { id: p.rentalId },
    include: {
      item: { select: { title: true, pricePerDay: true, replacementValue: true } },
      returnLocker: { select: { id: true, lockerNumber: true } },
    },
  });
  if (!rental) throw new Error(`openDispute: rental ${p.rentalId} not found`);

  const previous = await prisma.dispute.findFirst({
    where: { rentalId: rental.id, status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
  });
  const priorCases = await prisma.dispute.count({
    where: { renterId: rental.renterId, status: { not: "CANCELLED" } },
  });
  const offense = priorCases + 1;
  const deadlineHours = deadlineHoursFor(offense, p.deadlineHours);
  const paidEarlier = (
    await prisma.transaction.findMany({
      where: { rentalId: rental.id, type: "DISPUTE_FEE", status: "COMPLETED" },
      select: { amount: true },
    })
  ).reduce((s, t) => s + t.amount, 0);
  const capBase =
    rental.item.replacementValue ?? Math.max(rental.securityDeposit, rental.item.pricePerDay * FALLBACK_CAP_DAYS);
  const feeStartAt = offense >= 2 || p.feesStartNow ? now : rental.endDate;
  const verificationId = p.verificationId ?? rental.verificationId;
  const verdict = await verdictFor(verificationId, rental.item.title);
  const aiSummary = verdict ? [verdict.headline, ...verdict.points].join("\n") : null;

  // Where the wrong item is: the bay the return used, whichever compartment.
  const bay = rental.returnLocker;
  const where = bay ? await compartmentHolding(bay.id, rental.id) : null;

  const dispute = await withReference("DSP", (referenceNo) =>
    prisma.dispute.create({
      data: {
        referenceNo,
        rentalId: rental.id,
        renterId: rental.renterId,
        ownerId: rental.ownerId,
        offense,
        status: "OPEN",
        openedById: p.adminId ?? null,
        openedAt: now,
        deadlineHours,
        deadlineAt: new Date(now.getTime() + deadlineHours * 3_600_000),
        feeStartAt,
        feeBase: rental.item.pricePerDay,
        feeCap: Math.max(0, capBase - paidEarlier),
        aiSummary,
        reminderStage: 0,
        ...(bay && where
          ? {
              wrongItemLockerId: bay.id,
              wrongItemDoor: where === "top" ? "main_door" : "bottom_door",
              wrongItemPlacedAt: now,
            }
          : {}),
      },
    }),
  );

  if (previous) {
    await prisma.dispute.update({
      where: { id: previous.id },
      data: {
        status: "RESOLVED",
        resolution: "SUPERSEDED",
        resolvedAt: now,
        resolvedById: p.adminId ?? null,
        resolutionNote: `A second wrong item was returned; continued as ${dispute.referenceNo}.`,
      },
    });
    await recordEvent(previous.id, {
      type: "RESOLVED",
      actorRole: "ADMIN",
      actorId: p.adminId,
      message: `Superseded by ${dispute.referenceNo}: the renter returned a second wrong item. Fees paid on this case are kept.`,
    });
  }

  await prisma.rental.update({
    where: { id: rental.id },
    data: { status: "DISPUTED", verificationStatus: "REJECTED" },
  });

  if (bay && where) {
    // The wrong item is the renter's to collect from now on. Marked so no new
    // item can be put on top of it (the AWAITING_RETRIEVAL invariant).
    await setCompartment(bay.id, where, { status: "AWAITING_RETRIEVAL", rentalId: rental.id });
    if (io) await emitOccupancyForLockerId(io, bay.id);
  }

  if (offense >= 2) {
    await prisma.user.update({
      where: { id: rental.renterId },
      data: {
        restrictedUntilReviewAt: now,
        restrictionNote: `Second wrong item (${dispute.referenceNo}). Suspended until an admin reviews the account.`,
      },
    });
  }

  await recordEvent(dispute.id, {
    type: "OPENED",
    actorRole: p.adminId ? "ADMIN" : "SYSTEM",
    actorId: p.adminId,
    message:
      (p.note ? `${p.note}\n` : "") +
      `Opened (offence ${offense}). Deadline ${deadlineHours} h. Fees from ${feeStartAt.toISOString()} on ₱${rental.item.pricePerDay}/day, ` +
      `capped at ₱${Math.max(0, capBase - paidEarlier)}` +
      (rental.item.replacementValue == null
        ? ` (the larger of the deposit and ${FALLBACK_CAP_DAYS} days of the daily price: the owner has not stated a replacement value yet; the cap follows the owner's value once entered)`
        : "") +
      `.` +
      (bay && where
        ? ` Wrong item in bay ${bay.lockerNumber}, ${where === "top" ? "upper" : "lower"} compartment, for the RENTER to collect.`
        : " The wrong item is not recorded in any compartment: check the bay."),
    metadata: { verificationId, offense, deadlineHours },
  });

  const ctx = await messageContext(dispute, now);
  await tellParty(io, dispute, "RENTER", renterPromptTitle(ctx), renterPrompt(ctx), { email: true, type: "PROMPT" });
  await tellParty(io, dispute, "OWNER", ownerNoticeTitle(), ownerNotice(ctx), { email: true });

  await recomputeItemAvailability(rental.itemId);
  if (io) {
    notifyAdmins(io, "admin:dispute_opened", {
      rentalId: rental.id,
      disputeId: dispute.id,
      referenceNo: dispute.referenceNo,
      itemTitle: rental.item.title,
      offense,
      openedAt: now.toISOString(),
    });
    io.to(`user:${rental.renterId}`).emit("return:disputed", { rentalId: rental.id, disputeId: dispute.id });
    io.to(`user:${rental.ownerId}`).emit("return:disputed", { rentalId: rental.id, disputeId: dispute.id });
  }

  if (offense >= 2) await escalate(io, dispute, "A second wrong item: escalation goes straight to the guardian and UCLM (ruling 10).");

  // Ruling 2026-10-10, kept: the wrong item goes down at once so the upper
  // compartment is free. Refused safely if the bay is busy; the sweep retries.
  if (io && bay && where === "top") {
    const drop = await dropWrongItem(io, dispute.id);
    if (!drop.dropped) {
      logger.warn(`[DISPUTE] ${dispute.referenceNo}: wrong item stays up top for now: ${drop.refusal}`);
      await recordEvent(dispute.id, {
        type: "NOTE",
        actorRole: "SYSTEM",
        message: `The wrong item stays in the upper compartment for now (${drop.refusal}). It is collectable there; the sweep retries the drop.`,
      });
    }
  }

  logger.info(`[DISPUTE] opened ${dispute.referenceNo} on rental ${rental.id} (offence ${offense})`);
  return dispute;
}

/** Generate the three UCLM letter drafts and tell the admins what personnel must do. */
export async function escalate(io: Server | undefined, d: Dispute, why: string): Promise<void> {
  const marked = await prisma.dispute.updateMany({ where: { id: d.id, escalatedAt: null }, data: { escalatedAt: new Date() } });
  if (marked.count === 0) return;
  const { generateLetter } = await import("./disputeLetterService");
  for (const office of ["SAO", "ENGINEERING", "GUIDANCE"] as const) {
    try {
      await generateLetter(d.id, office, null);
    } catch (err) {
      logger.error(`[DISPUTE] letter for ${office} on ${d.referenceNo} failed:`, err);
    }
  }
  await recordEvent(d.id, {
    type: "ESCALATED",
    actorRole: "SYSTEM",
    audience: "ADMIN",
    message:
      `${why}\nPersonnel to do now, and log each attempt on this case: (1) call and email the renter; ` +
      `(2) if they cannot be reached, contact the parent or guardian on record; (3) review and submit the generated ` +
      `letters to the UCLM Student Affairs Office, the Engineering Faculty and the Guidance Office.`,
  });
  if (io) notifyAdmins(io, "admin:dispute_escalated", { disputeId: d.id, referenceNo: d.referenceNo });
}

/** Ruling 7: fees freeze when a payment is submitted. */
export async function freezeFees(disputeId: string, why: string): Promise<void> {
  const r = await prisma.dispute.updateMany({
    where: { id: disputeId, feesFrozenAt: null },
    data: { feesFrozenAt: new Date() },
  });
  if (r.count > 0) await recordEvent(disputeId, { type: "FEES_FROZEN", actorRole: "SYSTEM", message: why });
}

/** Ruling 7: ...and resume if the payment is rejected or the return does not happen. */
export async function resumeFees(disputeId: string, why: string): Promise<void> {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d?.feesFrozenAt) return;
  const frozenFor = Math.max(0, Math.round((Date.now() - d.feesFrozenAt.getTime()) / 1000));
  await prisma.dispute.update({
    where: { id: disputeId },
    data: { feesFrozenAt: null, frozenSeconds: d.frozenSeconds + frozenFor },
  });
  await recordEvent(disputeId, { type: "FEES_RESUMED", actorRole: "SYSTEM", message: why });
}

/** The correct item is in a locker after a paid visit: an admin must check it. */
export async function onDisputeReturnPlaced(rentalId: string, verificationId: string): Promise<void> {
  const d = await prisma.dispute.findFirst({
    where: { rentalId, status: { in: ["PAID", "OPEN", "PAYMENT_PENDING"] } },
    orderBy: { openedAt: "desc" },
  });
  if (!d) return;
  await prisma.dispute.update({ where: { id: d.id }, data: { status: "RETURN_REVIEW" } });
  await freezeFees(d.id, "The item was placed in the locker: fees stay frozen while an admin checks it.");
  await recordEvent(d.id, {
    type: "CORRECT_ITEM_PLACED",
    actorRole: "RENTER",
    actorId: d.renterId,
    message: "The renter placed an item for the return. The AI checked it; it now waits for an admin's review.",
    metadata: { verificationId },
  });
}

/** An admin approved the return of a disputed rental: the case is closed. */
export async function onDisputeReturnApproved(io: Server | undefined, rentalId: string, adminId?: string | null): Promise<void> {
  const d = await prisma.dispute.findFirst({
    where: { rentalId, status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
    orderBy: { openedAt: "desc" },
    include: { rental: { select: { item: { select: { title: true } } } } },
  });
  if (!d) return;
  await prisma.dispute.update({
    where: { id: d.id },
    data: { status: "RESOLVED", resolution: "CORRECT_ITEM_RETURNED", resolvedAt: new Date(), resolvedById: adminId ?? null },
  });
  await recordEvent(d.id, { type: "RESOLVED", actorRole: "ADMIN", actorId: adminId, message: "The correct item was returned and approved." });
  await tellParty(io, d, "RENTER", "Dispute closed", resolvedRenterText(d.referenceNo, d.rental.item.title), { email: true });
  await tellParty(
    io,
    d,
    "OWNER",
    "Your item is back",
    `Your ${d.rental.item.title} has been returned and checked by an admin (case ${d.referenceNo}). Scan the kiosk QR code to collect it. Your payout is being processed.`,
    { email: true },
  );
}

/** Ruling 4: the admin may set 1, 2 or 3 days per case (a repeat offence stays at 24 h). */
export async function setDeadline(disputeId: string, hours: number, adminId: string): Promise<Dispute> {
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw new Error("not found");
  const h = deadlineHoursFor(d.offense, hours);
  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: { deadlineHours: h, deadlineAt: new Date(d.openedAt.getTime() + h * 3_600_000) },
  });
  await recordEvent(disputeId, {
    type: "DEADLINE_CHANGED",
    actorRole: "ADMIN",
    actorId: adminId,
    message: `Deadline set to ${h} h (now ${updated.deadlineAt.toISOString()}).${d.offense >= 2 && hours !== h ? " A repeat offence is always 24 h." : ""}`,
  });
  return updated;
}

/**
 * Admin closes a case another way:
 *  OVERTURNED  — the renter's review was upheld: the "wrong" item was the right
 *                one. Fees are refunded (ledger), the restriction lifts, and the
 *                item in the locker is handed to the OWNER through the normal
 *                approved-return path.
 *  UNRECOVERED — the correct item is not coming back: the owner's claim of the
 *                item's full value is recorded and the renter is banned.
 */
export async function closeDispute(
  io: Server | undefined,
  disputeId: string,
  p: { resolution: "OVERTURNED" | "UNRECOVERED"; adminId: string; note: string },
): Promise<void> {
  const d = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { rental: { include: { item: true } } },
  });
  if (!d) throw new Error("not found");
  if (!(ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(d.status)) throw new Error("This case is already closed");
  const now = new Date();

  if (p.resolution === "OVERTURNED") {
    const paid = await prisma.transaction.findMany({ where: { disputeId, type: "DISPUTE_FEE", status: "COMPLETED" } });
    for (const t of paid) {
      await prisma.transaction.update({
        where: { id: t.id },
        data: {
          status: "REFUNDED",
          paymentDetails: {
            ...((t.paymentDetails as Record<string, unknown> | null) ?? {}),
            refund: { reason: "dispute overturned", at: now.toISOString(), by: p.adminId },
          } as never,
        },
      });
    }
    await prisma.dispute.update({
      where: { id: disputeId },
      data: { status: "CANCELLED", resolution: "OVERTURNED", resolvedAt: now, resolvedById: p.adminId, resolutionNote: p.note },
    });
    // The object in the locker IS the owner's item: it was never the renter's
    // to collect. Take it off the renter and put the rental back where an
    // approved return sits, so the owner collects it the normal way.
    if (d.wrongItemLockerId && !d.wrongItemCollectedAt) {
      await prisma.dispute.update({ where: { id: disputeId }, data: { wrongItemCollectedAt: now } });
      await prisma.rental.update({
        where: { id: d.rentalId },
        data: { status: "VERIFICATION", verificationStatus: "MANUAL_REVIEW", returnLockerId: d.wrongItemLockerId },
      });
      const { approveReturn } = await import("./returnApprovalService");
      await approveReturn(io, d.rentalId);
    }
    await recordEvent(disputeId, { type: "RESOLVED", actorRole: "ADMIN", actorId: p.adminId, message: `Overturned: ${p.note}` });
    await tellParty(io, d, "RENTER", "Dispute cancelled", overturnedRenterText(d.referenceNo, d.rental.item.title), { email: true });
  } else {
    const stated = d.rental.item.replacementValue;
    const valueText = stated != null ? `₱${stated.toFixed(2)}` : "the item's value, to be stated by the owner";
    await prisma.dispute.update({
      where: { id: disputeId },
      data: { status: "RESOLVED", resolution: "UNRECOVERED", resolvedAt: now, resolvedById: p.adminId, resolutionNote: p.note },
    });
    await prisma.user.update({
      where: { id: d.renterId },
      data: {
        restrictedUntilReviewAt: now,
        restrictionNote: `Permanently banned: item not recovered (${d.referenceNo}). ${p.note}`,
      },
    });
    await recordEvent(disputeId, {
      type: "RESOLVED",
      actorRole: "ADMIN",
      actorId: p.adminId,
      message: `Closed as unrecovered: the owner may claim the item's full value (${valueText}). The renter's account is banned. ${p.note}`,
    });
    await tellParty(
      io,
      d,
      "RENTER",
      "Dispute closed: item not recovered",
      `Case ${d.referenceNo} has been closed because the correct ${d.rental.item.title} was not returned. Your account is banned, and the owner may claim the item's full value (${valueText}). The case will be reported to UCLM.`,
      { email: true },
    );
    await tellParty(
      io,
      d,
      "OWNER",
      "Dispute closed: item not recovered",
      `Case ${d.referenceNo}: your ${d.rental.item.title} was not returned. An admin has recorded your claim to the item's full value (${valueText}) and will contact you about it.`,
      { email: true },
    );
  }
  await recomputeItemAvailability(d.rental.itemId);
  io?.to(`user:${d.renterId}`).emit("dispute:update", { disputeId, rentalId: d.rentalId });
}

/**
 * The dispute sweep (every 15 min): reminders at day 0/1/2/deadline (ruling 11),
 * escalation at the deadline, retrying a refused wrong-item drop, and
 * surfacing drops the Pi never acknowledged.
 */
export async function runDisputeSweep(io: Server, now = new Date()): Promise<{ reminded: number; escalated: number; dropped: number }> {
  let reminded = 0;
  let escalated = 0;
  let dropped = 0;
  const open = await prisma.dispute.findMany({ where: { status: { in: [...RENTER_ACTION_STATUSES] } } });
  for (const d of open) {
    const stage = reminderStageDue(d.openedAt, d.deadlineAt, now);
    if (stage > d.reminderStage) {
      const ctx = await messageContext(d, now);
      await tellParty(io, d, "RENTER", reminderTitle(stage), reminderText(ctx, stage), { email: true, type: "REMINDER" });
      await prisma.dispute.update({ where: { id: d.id }, data: { reminderStage: stage } });
      reminded += 1;
    }
    if (now >= d.deadlineAt && !d.escalatedAt) {
      await escalate(io, d, `The deadline (${d.deadlineAt.toISOString()}) passed without the correct item being returned.`);
      escalated += 1;
    }
  }

  const waitingUp = await prisma.dispute.findMany({
    where: { wrongItemDoor: "main_door", wrongItemPlacedAt: { not: null }, wrongItemCollectedAt: null, wrongItemDropAt: null },
    select: { id: true },
  });
  for (const w of waitingUp) {
    const r = await dropWrongItem(io, w.id);
    if (r.dropped) dropped += 1;
  }

  for (const lost of await findUnacknowledgedWrongItemDrops()) {
    logger.error(`[DISPUTE] F3: wrong-item drop for ${lost.referenceNo} sent ${lost.wrongItemDropAt?.toISOString()} and never acknowledged`);
    notifyAdmins(io, "admin:dispute_drop_unconfirmed", { disputeId: lost.id, referenceNo: lost.referenceNo });
  }
  return { reminded, escalated, dropped };
}

/**
 * The user's ruling for 6a7ccbef (2026-10-11): migrate the pre-v2 case. The
 * item already in the lower compartment becomes the renter's to collect, the
 * owner's collection grant goes away, and the 72 h deadline and the fees start
 * NOW, not retroactively. Nothing physical moves.
 */
export async function migrateLegacyDispute(io: Server | undefined, rentalId: string, adminId: string): Promise<Dispute> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: { retrievalLocker: { select: { id: true, lockerNumber: true } } },
  });
  if (!rental) throw new Error("Rental not found");
  if (rental.status !== "DISPUTED") throw new Error("Only a DISPUTED rental can be migrated");
  if (await prisma.dispute.findFirst({ where: { rentalId } })) throw new Error("This rental already has a v2 case");

  const bay = rental.retrievalLocker;
  const where = bay ? await compartmentHolding(bay.id, rentalId) : null;
  const before = {
    releaseReason: rental.releaseReason,
    releaseRequestedAt: rental.releaseRequestedAt,
    releasedAt: rental.releasedAt,
    retrievalLockerId: rental.retrievalLockerId,
    retrievedAt: rental.retrievedAt,
  };

  // The rental's retrieval columns described the owner collecting this item.
  // Under v2 they must be clear, so the correct item's later release to the
  // owner is not refused as "already released" (and resolveFaceSubject stops
  // sending this rental's kiosk scans to the owner).
  await prisma.rental.update({
    where: { id: rentalId },
    data: {
      releaseReason: null,
      releaseRequestedAt: null,
      releasedAt: null,
      retrievalLockerId: null,
      retrievedAt: null,
      ...(bay && { returnLockerId: bay.id }),
    },
  });

  const d = await openDispute(io, {
    rentalId,
    adminId,
    deadlineHours: 72,
    feesStartNow: true,
    note:
      `Migrated from the pre-v2 case (user ruling 2026-10-11). Deadline and fees start now. ` +
      `Previous retrieval state: ${JSON.stringify(before)}.`,
  });

  if (bay && where && !before.retrievedAt) {
    // openDispute found the item through returnLocker; make sure the location
    // reflects exactly where it already is, without moving anything.
    await prisma.dispute.update({
      where: { id: d.id },
      data: {
        wrongItemLockerId: bay.id,
        wrongItemDoor: where === "top" ? "main_door" : "bottom_door",
        wrongItemPlacedAt: new Date(),
      },
    });
  }
  return d;
}
