import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors";
import logger from "../utils/logger";
import { notifyAdmins } from "../services/adminRoom";
import { recordAudit } from "../services/auditLogService";
import { plainVerdict } from "../services/aiVerdictSummary";
import { bandsFor } from "../services/disputeFees";
import { recordEvent, tellParty } from "../services/disputeEvents";
import {
  ACTIVE_DISPUTE_STATUSES,
  closeDispute,
  disputeMoney,
  feeCapFor,
  getRestriction,
  messageContext,
  migrateLegacyDispute,
  setDeadline,
} from "../services/disputeService";
import { createDisputePayment, endVisit, liveVisitForDispute } from "../services/disputeKioskService";
import { dropWrongItem, wrongItemTarget } from "../services/disputeWrongItemService";
import { generateLetter, markLetterSubmitted, Office, OFFICES } from "../services/disputeLetterService";

/**
 * Dispute System v2 endpoints (user rulings 2026-10-11).
 *
 * Ruling 14: everything visible to everyone it concerns. The RENTER sees their
 * case in full (countdown, fees, steps, consequences, history of what they
 * were told); the OWNER sees its status and what they were told, never the
 * renter's personal details; the ADMIN sees all of it, including the exact
 * words each party was shown.
 */

const RENTER_VISIBLE_EVENTS = new Set([
  "OPENED",
  "PROMPT",
  "MESSAGE",
  "REMINDER",
  "WRONG_ITEM_PLACED",
  "WRONG_ITEM_COLLECTED",
  "PAYMENT_SUBMITTED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REJECTED",
  "FEES_FROZEN",
  "FEES_RESUMED",
  "CORRECT_ITEM_PLACED",
  "DEADLINE_CHANGED",
  "REVIEW_REQUESTED",
  "KIOSK_VISIT",
  "KIOSK_VISIT_ENDED",
  "RESOLVED",
]);

async function loadCase(id: string) {
  const d = await prisma.dispute.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      letters: { orderBy: { generatedAt: "asc" } },
      rental: {
        include: {
          item: {
            select: { id: true, title: true, images: true, pricePerDay: true, replacementValue: true, securityDeposit: true },
          },
          renter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              studentId: true,
              parentName: true,
              parentContact: true,
              restrictedUntilReviewAt: true,
              restrictionNote: true,
            },
          },
          owner: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, studentId: true } },
          returnLocker: { select: { lockerNumber: true } },
          verification: true,
        },
      },
    },
  });
  if (!d) throw new NotFoundError("Case not found");
  return d;
}

async function wrongItemView(d: { wrongItemLockerId: string | null; wrongItemDoor: string | null; wrongItemDropAt: Date | null; wrongItemPlacedAt: Date | null; wrongItemCollectedAt: Date | null; id: string }) {
  if (!d.wrongItemLockerId) return null;
  const bay = await prisma.locker.findUnique({ where: { id: d.wrongItemLockerId }, select: { lockerNumber: true, kioskId: true } });
  return {
    lockerNumber: bay?.lockerNumber ?? null,
    kioskId: bay?.kioskId ?? null,
    door: d.wrongItemDoor,
    moving: Boolean(d.wrongItemDropAt && !d.wrongItemPlacedAt),
    collectable: Boolean(d.wrongItemPlacedAt && !d.wrongItemCollectedAt),
    collectedAt: d.wrongItemCollectedAt,
    // What the phone sends as `rentalId` on the kiosk scan to collect it.
    kioskTarget: wrongItemTarget(d.id),
  };
}

function verdictFor(c: Awaited<ReturnType<typeof loadCase>>) {
  const v = c.rental.verification;
  if (!v) return null;
  return plainVerdict({
    itemTitle: c.rental.item.title,
    score: v.confidenceScore,
    mlEvidence: v.mlEvidence as never,
    deepReviewDetails: v.deepReviewDetails as never,
    deepReviewScore: v.deepReviewScore,
    unavailable: v.unavailable,
    unavailableReason: v.unavailableReason,
    adminDecision: "REJECTED",
  });
}

async function moneyView(c: Awaited<ReturnType<typeof loadCase>>) {
  const m = await disputeMoney(c);
  return {
    ...m,
    feeBase: c.feeBase,
    feeCap: (await feeCapFor(c)).cap,
    feeCapSource: m.capSource,
    feeCapAtOpen: c.feeCap,
    feeStartAt: c.feeStartAt,
    frozen: Boolean(c.feesFrozenAt),
    schedule: bandsFor(c.offense).map((b) => ({
      fromDay: b.fromDay,
      toDay: b.toDay,
      multiplier: b.multiplier,
      perDay: Math.round(c.feeBase * b.multiplier * 100) / 100,
    })),
  };
}

// ── Student ──────────────────────────────────────────────────────────────────

/** GET /disputes/restriction — what the app's restricted mode mirrors. */
export const myRestriction = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    res.json({ success: true, data: await getRestriction(req.user.userId) });
  } catch (error) {
    next(error);
  }
};

/** GET /disputes/mine — cases where I am the renter or the owner. */
export const myDisputes = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    const rows = await prisma.dispute.findMany({
      where: { OR: [{ renterId: req.user.userId }, { ownerId: req.user.userId }] },
      orderBy: { openedAt: "desc" },
      include: { rental: { select: { id: true, item: { select: { title: true } } } } },
    });
    const out = [];
    for (const d of rows) {
      const isRenter = d.renterId === req.user.userId;
      const money = isRenter ? await disputeMoney(d) : null;
      out.push({
        id: d.id,
        referenceNo: d.referenceNo,
        rentalId: d.rentalId,
        itemTitle: d.rental.item.title,
        role: isRenter ? "RENTER" : "OWNER",
        status: d.status,
        offense: isRenter ? d.offense : undefined,
        openedAt: d.openedAt,
        deadlineAt: isRenter ? d.deadlineAt : undefined,
        owed: money?.owed,
        wrongItemWaiting: isRenter ? Boolean(d.wrongItemPlacedAt && !d.wrongItemCollectedAt) : undefined,
      });
    }
    res.json({ success: true, data: { disputes: out } });
  } catch (error) {
    next(error);
  }
};

/** GET /disputes/:id — the renter's full case, or the owner's status view. */
export const getDispute = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    const c = await loadCase(req.params.id as string);
    const isRenter = c.renterId === req.user.userId;
    const isOwner = c.ownerId === req.user.userId;
    if (!isRenter && !isOwner) throw new ForbiddenError("Access denied");
    const verdict = verdictFor(c);

    if (isOwner && !isRenter) {
      const told = c.events.filter((e) => e.audience === "OWNER" && e.channel === "IN_APP");
      res.json({
        success: true,
        data: {
          role: "OWNER",
          id: c.id,
          referenceNo: c.referenceNo,
          rentalId: c.rentalId,
          itemTitle: c.rental.item.title,
          status: c.status,
          resolution: c.resolution,
          openedAt: c.openedAt,
          resolvedAt: c.resolvedAt,
          aiVerdict: verdict,
          // Ruling 9: the owner is out of it; they see what they were told.
          messages: told.map((e) => ({ at: e.createdAt, title: e.title, message: e.message })),
        },
      });
      return;
    }

    const prompt = [...c.events].reverse().find((e) => e.type === "PROMPT" && e.channel === "IN_APP");
    const visit = liveVisitForDispute(c.id);
    res.json({
      success: true,
      data: {
        role: "RENTER",
        id: c.id,
        referenceNo: c.referenceNo,
        rentalId: c.rentalId,
        itemTitle: c.rental.item.title,
        status: c.status,
        resolution: c.resolution,
        offense: c.offense,
        openedAt: c.openedAt,
        deadlineAt: c.deadlineAt,
        deadlineHours: c.deadlineHours,
        escalatedAt: c.escalatedAt,
        reviewRequestedAt: c.reviewRequestedAt,
        resolvedAt: c.resolvedAt,
        restricted: (ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(c.status) || Boolean(c.rental.renter.restrictedUntilReviewAt),
        suspendedUntilReview: Boolean(c.rental.renter.restrictedUntilReviewAt),
        prompt: prompt ? { title: prompt.title, message: prompt.message, at: prompt.createdAt } : null,
        aiVerdict: verdict,
        money: await moneyView(c),
        wrongItem: await wrongItemView(c),
        visit: visit
          ? { expiresAt: visit.expiresAt, transactionId: visit.transactionId, doorGranted: visit.doorGranted, kioskId: visit.kioskId }
          : null,
        history: c.events
          .filter((e) => RENTER_VISIBLE_EVENTS.has(e.type) && (e.audience == null || e.audience === "RENTER"))
          .map((e) => ({ at: e.createdAt, type: e.type, channel: e.channel, title: e.title, message: e.message })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/** POST /disputes/:id/pay — during a live kiosk visit (ruling 6). */
export const payDispute = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    try {
      const out = await createDisputePayment(req.app.get("io"), { disputeId: req.params.id as string, userId: req.user.userId });
      res.status(201).json({ success: true, data: out });
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
  } catch (error) {
    next(error);
  }
};

/** POST /disputes/:id/cancel-visit — the renter walks away; ends safely. */
export const cancelDisputeVisit = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    const d = await prisma.dispute.findUnique({ where: { id: req.params.id as string } });
    if (!d) throw new NotFoundError("Case not found");
    if (d.renterId !== req.user.userId) throw new ForbiddenError("Access denied");
    await endVisit(req.app.get("io"), d.rentalId, "cancelled");
    res.json({ success: true, message: "Kiosk session ended" });
  } catch (error) {
    next(error);
  }
};

/** POST /disputes/:id/review-request — "Think this is a mistake?" */
export const requestReview = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 5) throw new ValidationError("Please explain why you think this is a mistake");
    const d = await prisma.dispute.findUnique({
      where: { id: req.params.id as string },
      include: { rental: { select: { item: { select: { title: true } } } } },
    });
    if (!d) throw new NotFoundError("Case not found");
    if (d.renterId !== req.user.userId) throw new ForbiddenError("Access denied");
    if (!(ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(d.status)) throw new ValidationError("This case is closed");
    await prisma.dispute.update({ where: { id: d.id }, data: { reviewRequestedAt: new Date() } });
    await recordEvent(d.id, {
      type: "REVIEW_REQUESTED",
      actorRole: "RENTER",
      actorId: req.user.userId,
      audience: "ADMIN",
      message: reason.slice(0, 2000),
    });
    const io = req.app.get("io");
    if (io) notifyAdmins(io, "admin:dispute_review_requested", { disputeId: d.id, referenceNo: d.referenceNo });
    await tellParty(
      io,
      d,
      "RENTER",
      "Review requested",
      `We received your request to review case ${d.referenceNo}. An admin will look at the locker photos again and reply here. Until then the case stays open and the steps still apply.`,
      {},
    );
    res.json({ success: true, message: "Review requested" });
  } catch (error) {
    next(error);
  }
};

// ── Admin ────────────────────────────────────────────────────────────────────

/** GET /admin/disputes — v2 cases, plus pre-v2 DISPUTED rentals still to migrate. */
export const adminListDisputes = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const rows = await prisma.dispute.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { openedAt: "desc" },
      take: 200,
      include: {
        rental: {
          select: {
            id: true,
            item: { select: { title: true } },
            renter: { select: { firstName: true, lastName: true, studentId: true } },
            owner: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    const disputes = [];
    for (const d of rows) {
      const m = await disputeMoney(d);
      disputes.push({
        id: d.id,
        referenceNo: d.referenceNo,
        rentalId: d.rentalId,
        itemTitle: d.rental.item.title,
        renter: d.rental.renter,
        owner: d.rental.owner,
        status: d.status,
        resolution: d.resolution,
        offense: d.offense,
        openedAt: d.openedAt,
        deadlineAt: d.deadlineAt,
        escalatedAt: d.escalatedAt,
        reviewRequestedAt: d.reviewRequestedAt,
        owed: m.owed,
        paid: m.paid,
        pending: m.pending,
        wrongItemWaiting: Boolean(d.wrongItemPlacedAt && !d.wrongItemCollectedAt),
        wrongItemMoving: Boolean(d.wrongItemDropAt && !d.wrongItemPlacedAt),
      });
    }
    const legacy = await prisma.rental.findMany({
      where: { status: "DISPUTED", disputes: { none: {} } },
      select: {
        id: true,
        updatedAt: true,
        item: { select: { title: true } },
        renter: { select: { firstName: true, lastName: true } },
        owner: { select: { firstName: true, lastName: true } },
        releaseReason: true,
        releasedAt: true,
        retrievedAt: true,
      },
    });
    res.json({ success: true, data: { disputes, legacy } });
  } catch (error) {
    next(error);
  }
};

/** GET /admin/disputes/:id — the whole case. */
export const adminGetDispute = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const c = await loadCase(req.params.id as string);
    const transactions = await prisma.transaction.findMany({
      where: { OR: [{ disputeId: c.id }, { rentalId: c.rentalId }] },
      orderBy: { createdAt: "asc" },
    });
    const visit = liveVisitForDispute(c.id);
    res.json({
      success: true,
      data: {
        dispute: {
          ...c,
          events: undefined,
          letters: undefined,
          rental: undefined,
        },
        rental: c.rental,
        aiVerdict: verdictFor(c),
        money: await moneyView(c),
        wrongItem: await wrongItemView(c),
        visit: visit ? { expiresAt: visit.expiresAt, transactionId: visit.transactionId, doorGranted: visit.doorGranted, kioskId: visit.kioskId } : null,
        events: c.events,
        letters: c.letters,
        transactions,
        offices: OFFICES,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const adminSetDeadline = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hours = Number(req.body?.hours);
    if (![24, 48, 72].includes(hours)) throw new ValidationError("hours must be 24, 48 or 72");
    const d = await setDeadline(req.params.id as string, hours, req.user!.userId);
    await recordAudit(req, { action: "dispute.deadline", targetType: "dispute", targetId: d.id, metadata: { hours: d.deadlineHours } });
    const io = req.app.get("io");
    await tellParty(
      io,
      d,
      "RENTER",
      "Dispute deadline updated",
      `The deadline for case ${d.referenceNo} is now ${d.deadlineAt.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}.`,
      { email: true },
    );
    res.json({ success: true, data: { deadlineAt: d.deadlineAt, deadlineHours: d.deadlineHours } });
  } catch (error) {
    next(error);
  }
};

/** Ruling 11: personnel calls, guardian contact and school reports are done by people and LOGGED here. */
export const adminLogContact = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { audience, channel, outcome, note } = req.body as Record<string, string>;
    const d = await prisma.dispute.findUnique({ where: { id: req.params.id as string } });
    if (!d) throw new NotFoundError("Case not found");
    await recordEvent(d.id, {
      type: "CONTACT",
      actorRole: "ADMIN",
      actorId: req.user!.userId,
      audience: audience as never,
      channel,
      outcome,
      message: note ? String(note).slice(0, 2000) : null,
    });
    await recordAudit(req, { action: "dispute.contact", targetType: "dispute", targetId: d.id, metadata: { audience, channel, outcome } });
    res.json({ success: true, message: "Contact attempt logged" });
  } catch (error) {
    next(error);
  }
};

export const adminAddNote = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const note = String(req.body?.note ?? "").trim();
    if (!note) throw new ValidationError("note is required");
    await recordEvent(req.params.id as string, { type: "NOTE", actorRole: "ADMIN", actorId: req.user!.userId, message: note.slice(0, 4000) });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const adminGenerateLetter = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const office = req.body?.office as Office;
    if (!OFFICES[office]) throw new ValidationError("office must be SAO, ENGINEERING or GUIDANCE");
    const letter = await generateLetter(req.params.id as string, office, req.user!.userId);
    await recordAudit(req, { action: "dispute.letter", targetType: "dispute", targetId: req.params.id as string, metadata: { office, referenceNo: letter.referenceNo } });
    res.status(201).json({ success: true, data: { letter } });
  } catch (error) {
    next(error);
  }
};

export const adminMarkLetterSubmitted = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const letter = await markLetterSubmitted(req.params.letterId as string, req.user!.userId, req.body?.note ? String(req.body.note) : null);
    await recordAudit(req, { action: "dispute.letter_submitted", targetType: "dispute", targetId: letter.disputeId, metadata: { referenceNo: letter.referenceNo } });
    res.json({ success: true, data: { letter } });
  } catch (error) {
    next(error);
  }
};

export const adminCloseDispute = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const resolution = req.body?.resolution;
    const note = String(req.body?.note ?? "").trim();
    if (!["OVERTURNED", "UNRECOVERED"].includes(resolution)) throw new ValidationError("resolution must be OVERTURNED or UNRECOVERED");
    if (note.length < 5) throw new ValidationError("A note explaining the decision is required");
    try {
      await closeDispute(req.app.get("io"), req.params.id as string, { resolution, adminId: req.user!.userId, note });
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
    await recordAudit(req, { action: "dispute.close", targetType: "dispute", targetId: req.params.id as string, reason: note, metadata: { resolution } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

/** Drives the actuator: the same guards as the sweep. */
export const adminDropWrongItem = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const out = await dropWrongItem(req.app.get("io"), req.params.id as string);
    await recordAudit(req, { action: "dispute.drop_wrong_item", targetType: "dispute", targetId: req.params.id as string, metadata: { ...out } });
    res.json({ success: out.dropped, data: out, message: out.dropped ? `Drop sent to locker ${out.lockerNumber}` : out.refusal });
  } catch (error) {
    next(error);
  }
};

export const adminMigrateLegacy = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    let d;
    try {
      d = await migrateLegacyDispute(req.app.get("io"), req.params.rentalId as string, req.user!.userId);
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
    await recordAudit(req, { action: "dispute.migrate", targetType: "rental", targetId: req.params.rentalId as string, metadata: { disputeId: d.id, referenceNo: d.referenceNo } });
    logger.info(`[DISPUTE] rental ${req.params.rentalId} migrated to ${d.referenceNo} by ${req.user?.email}`);
    res.status(201).json({ success: true, data: { dispute: d } });
  } catch (error) {
    next(error);
  }
};

/** Re-send the renter the full, current case details (logged), with an
 *  optional preface, e.g. a correction of something an earlier message said. */
export const adminResendPrompt = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const d = await prisma.dispute.findUnique({ where: { id: req.params.id as string } });
    if (!d) throw new NotFoundError("Case not found");
    const preface = String(req.body?.preface ?? "").trim();
    const ctx = await messageContext(d);
    const { renterPrompt } = await import("../services/disputeMessages");
    await tellParty(
      req.app.get("io"),
      d,
      "RENTER",
      preface ? "Correction: your dispute details" : "Your dispute details",
      (preface ? `${preface}

` : "") + renterPrompt(ctx),
      { email: true, type: "PROMPT", actorRole: "ADMIN", actorId: req.user!.userId },
    );
    await recordAudit(req, { action: "dispute.resend_prompt", targetType: "dispute", targetId: d.id, reason: preface || null });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const adminLiftRestriction = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const note = String(req.body?.note ?? "").trim();
    if (note.length < 5) throw new ValidationError("A note explaining the review is required");
    const user = await prisma.user.update({
      where: { id: req.params.userId as string },
      data: { restrictedUntilReviewAt: null, restrictionNote: `Reviewed and lifted: ${note}` },
      select: { id: true },
    });
    await recordAudit(req, { action: "user.lift_restriction", targetType: "user", targetId: user.id, reason: note });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
