import crypto from "crypto";
import { Prisma } from "@prisma/client";
import type { Server } from "socket.io";
import prisma from "../config/database";
import env from "../config/env";
import logger from "../utils/logger";
import { sendEmail } from "../utils/email";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors";
import { notifyAdmins } from "./adminRoom";
import { textToHtml } from "./disputeEvents";
import { saveBuffer, signedMediaUrl } from "./storageService";
import { releaseHeldDeposit } from "./rentalSettlementService";
import { createRefund } from "../controllers/paymentController";
import {
  ConcernKindName,
  PartyName,
  RESPONSE_WINDOW_HOURS,
  REPEAT_THRESHOLD,
  REPEAT_WINDOW_DAYS,
  EARLY_RETURN_HOURS,
  KIND_TITLE,
  damageCap,
  damageOutcome,
  decisionStatus,
  defectRefund,
  evidenceProblems,
  evidenceRequirement,
  explainDecision,
  isSettled,
  reportWindows,
  clampPct,
} from "./concernRules";

/**
 * Concerns v2 (user rulings 2026-10-13; spec docs/redesign/SPEC-CONCERNS-V2.md).
 *
 * A student reports a problem the locker camera cannot see — with a written
 * account, photos and (for the two damage kinds) a video. The other student may
 * answer within 24 h. An admin then decides a percentage of responsibility, and
 * the money moves by the numbers in concernRules.ts. Every step is told to both
 * students in plain words (in the app, and by email), with what happens next.
 *
 * Kept apart from Dispute (the wrong-item case with escalating fees), so none of
 * that case's sweeps, fees or letters ever fire on a concern.
 */

const HOUR = 3_600_000;
const OPEN_STATUSES = ["AWAITING_RESPONSE", "UNDER_REVIEW"] as const;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const peso = (n: number) => `₱${n.toFixed(2)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const when = (d: Date) =>
  d.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

// ── helpers ────────────────────────────────────────────────────────────────

async function nextReference(now = new Date()): Promise<string> {
  const prefix = `ER-CON-${now.getFullYear()}-`;
  const count = await prisma.concern.count({ where: { referenceNo: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

/** What a stored file really is, from its own bytes (never the client's label). */
export function sniffEvidence(buf: Buffer): "jpg" | "png" | "webp" | "mp4" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  // ISO base media (MP4 / MOV / 3GP): a box size, then "ftyp".
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") return "mp4";
  return null;
}

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };

async function storeFiles(
  concernId: string,
  authorId: string,
  authorParty: PartyName | null,
  photos: UploadedFile[],
  videos: UploadedFile[],
): Promise<Prisma.ConcernEvidenceCreateManyInput[]> {
  const rows: Prisma.ConcernEvidenceCreateManyInput[] = [];
  for (const f of photos) {
    const kind = sniffEvidence(f.buffer);
    if (kind === null || kind === "mp4") throw new ValidationError("A photo is not a JPEG, PNG or WebP image.");
    if (f.size > MAX_PHOTO_BYTES) throw new ValidationError("Each photo must be under 10 MB.");
    const path = `cases/${concernId}/${crypto.randomUUID()}.${kind}`;
    await saveBuffer(path, f.buffer);
    rows.push({ concernId, authorId, authorParty, type: "PHOTO", path, mime: MIME[kind], sizeBytes: f.size });
  }
  for (const f of videos) {
    if (sniffEvidence(f.buffer) !== "mp4") throw new ValidationError("The video must be an MP4 recorded in the app.");
    if (f.size > MAX_VIDEO_BYTES) throw new ValidationError("The video must be under 40 MB (record up to 30 seconds).");
    const path = `cases/${concernId}/${crypto.randomUUID()}.mp4`;
    await saveBuffer(path, f.buffer);
    rows.push({ concernId, authorId, authorParty, type: "VIDEO", path, mime: "video/mp4", sizeBytes: f.size });
  }
  return rows;
}

async function event(concernId: string, type: string, actor: string, message: string): Promise<void> {
  try {
    await prisma.concernEvent.create({ data: { concernId, type, actor, message } });
  } catch (err) {
    logger.error(`[CONCERN] could not record event ${type} on ${concernId}:`, err);
  }
}

type ConcernWithPeople = Prisma.ConcernGetPayload<{
  include: { reporter: true; respondent: true; rental: { include: { item: true } } };
}>;

async function loadConcern(id: string): Promise<ConcernWithPeople> {
  const c = await prisma.concern.findUnique({
    where: { id },
    include: { reporter: true, respondent: true, rental: { include: { item: true } } },
  });
  if (!c) throw new NotFoundError("Case not found");
  return c;
}

/** In-app always, email when asked, and a live refresh for both phones. */
async function tell(
  io: Server | undefined,
  c: { id: string; rentalId: string; referenceNo: string },
  user: { id: string; email: string },
  title: string,
  text: string,
  email: boolean,
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: user.id,
      title,
      message: text,
      type: "DISPUTE_UPDATE",
      relatedEntityId: c.rentalId,
      relatedEntityType: "rental",
    },
  });
  if (email) {
    await sendEmail({
      to: user.email,
      subject: `${title} [${c.referenceNo}]`,
      html: textToHtml(title, text),
      text,
    }).catch((err) => logger.warn(`[CONCERN] email to ${user.email} failed: ${(err as Error).message}`));
  }
  io?.to(`user:${user.id}`).emit("concern:update", { rentalId: c.rentalId, concernId: c.id });
}

function party(rental: { renterId: string; ownerId: string }, userId: string): PartyName | null {
  if (rental.renterId === userId) return "RENTER";
  if (rental.ownerId === userId) return "OWNER";
  return null;
}

// ── what can be reported now (drives the app's button) ─────────────────────

export async function reportOptions(rentalId: string, userId: string, now = new Date()) {
  const rental = await prisma.rental.findUnique({ where: { id: rentalId } });
  if (!rental) throw new NotFoundError("Rental not found");
  const viewer = party(rental, userId);
  if (!viewer) throw new ForbiddenError("Access denied");
  const [open, refunded, concerns] = await Promise.all([
    prisma.concern.findMany({
      where: {
        rentalId,
        OR: [{ kind: { in: ["DEFECT_ON_RECEIPT", "DAMAGE_ON_RETURN"] } }, { kind: "RETURN_CHECK", status: { in: [...OPEN_STATUSES] } }],
      },
      select: { kind: true },
    }),
    prisma.transaction.count({ where: { rentalId, type: "DEPOSIT_REFUND" } }),
    prisma.concern.findMany({
      where: { rentalId },
      orderBy: { createdAt: "desc" },
      select: { id: true, referenceNo: true, kind: true, status: true, reporterId: true, responseDueAt: true, amountOwed: true, owedPaidAt: true },
    }),
  ]);
  const windows = reportWindows(
    {
      viewer,
      status: rental.status,
      verificationStatus: rental.verificationStatus,
      claimedAt: rental.claimedAt,
      depositHoldUntil: rental.depositHoldUntil,
      depositRefunded: refunded > 0,
      blockedKinds: open.map((o) => o.kind as ConcernKindName),
    },
    now,
  );
  return {
    viewer,
    windows: windows.map((w) => ({
      ...w,
      title: KIND_TITLE[w.kind],
      requirement: evidenceRequirement(w.kind, "REPORTER"),
    })),
    depositHoldUntil: rental.depositHoldUntil,
    cases: concerns.map((c) => ({
      ...c,
      mine: c.reporterId === userId,
      title: KIND_TITLE[c.kind as ConcernKindName],
      settled: isSettled(c),
    })),
  };
}

// ── report ──────────────────────────────────────────────────────────────────

export async function createConcern(
  io: Server | undefined,
  p: { userId: string; rentalId: string; kind: ConcernKindName; statement: string; photos: UploadedFile[]; videos: UploadedFile[] },
  now = new Date(),
) {
  const rental = await prisma.rental.findUnique({
    where: { id: p.rentalId },
    include: { item: true, renter: true, owner: true },
  });
  if (!rental) throw new NotFoundError("Rental not found");
  const viewer = party(rental, p.userId);
  if (!viewer) throw new ForbiddenError("Access denied");

  const opts = await reportOptions(p.rentalId, p.userId, now);
  const w = opts.windows.find((x) => x.kind === p.kind);
  if (!w) throw new ValidationError("Unknown kind of report.");
  if (!w.canReport) throw new ValidationError(w.reason ?? "This cannot be reported now.");

  const problems = evidenceProblems(evidenceRequirement(p.kind, "REPORTER"), {
    statement: p.statement,
    photos: p.photos.length,
    videos: p.videos.length,
  });
  if (problems.length) throw new ValidationError(problems.join(" "));

  const respondent = viewer === "RENTER" ? rental.owner : rental.renter;
  const reporter = viewer === "RENTER" ? rental.renter : rental.owner;
  const responseDueAt = new Date(now.getTime() + RESPONSE_WINDOW_HOURS * HOUR);

  let concern: { id: string; referenceNo: string; rentalId: string } | null = null;
  for (let attempt = 0; attempt < 5 && !concern; attempt++) {
    const ref = await nextReference(now);
    try {
      concern = await prisma.concern.create({
        data: {
          referenceNo: attempt === 0 ? ref : `${ref}-${attempt}`,
          rentalId: rental.id,
          kind: p.kind,
          reporterId: reporter.id,
          reporterParty: viewer,
          respondentId: respondent.id,
          responseDueAt,
        },
        select: { id: true, referenceNo: true, rentalId: true },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  if (!concern) throw new Error("Could not allocate a case reference number");

  try {
    const files = await storeFiles(concern.id, reporter.id, viewer, p.photos, p.videos);
    await prisma.concernEvidence.createMany({
      data: [
        { concernId: concern.id, authorId: reporter.id, authorParty: viewer, type: "STATEMENT", text: p.statement.trim() },
        ...files,
      ],
    });
  } catch (err) {
    // No half-made case: without its evidence it must not exist.
    await prisma.concern.delete({ where: { id: concern.id } }).catch(() => undefined);
    throw err;
  }

  const kindTitle = KIND_TITLE[p.kind];
  await event(concern.id, "REPORTED", viewer, `${viewer === "RENTER" ? "The renter" : "The owner"} reported: ${kindTitle}.`);

  if (p.kind === "RETURN_CHECK" && rental.verificationId) {
    // The return check itself now waits for a person, who sees this case beside it.
    await prisma.rental.update({ where: { id: rental.id }, data: { verificationStatus: "MANUAL_REVIEW" } });
    await prisma.verification.update({ where: { id: rental.verificationId }, data: { status: "MANUAL_REVIEW" } });
  }

  const item = rental.item.title;
  await tell(
    io,
    concern,
    reporter,
    "Report sent",
    `We received your report about ${item} (case ${concern.referenceNo}). ${viewer === "RENTER" ? "The owner" : "The renter"} can answer it until ${when(responseDueAt)}. ` +
      `Then an admin looks at both sides' photos, video and statements and decides. You will be told the decision here and by email.`,
    true,
  );
  await tell(
    io,
    concern,
    respondent,
    `A problem was reported: ${item}`,
    `${viewer === "RENTER" ? "The renter" : "The owner"} reported "${kindTitle.toLowerCase()}" for ${item} (case ${concern.referenceNo}). ` +
      `Open the rental in the app to see their photos, video and statement, and give your side with your own photos or video ` +
      `before ${when(responseDueAt)}. An admin decides after that, even if you do not answer.`,
    true,
  );
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      title: `New case ${concern!.referenceNo}`,
      message: `${kindTitle}: ${item}. The other student can answer until ${when(responseDueAt)}.`,
      type: "SYSTEM_ANNOUNCEMENT" as const,
      relatedEntityId: concern!.id,
      relatedEntityType: "concern",
    })),
  });
  notifyAdmins(io, "admin:concern", { concernId: concern.id, referenceNo: concern.referenceNo, kind: p.kind });
  logger.info(`[CONCERN] ${concern.referenceNo} ${p.kind} opened by the ${viewer} on rental ${rental.id}`);
  return concern;
}

// ── answer ──────────────────────────────────────────────────────────────────

export async function respondToConcern(
  io: Server | undefined,
  p: { userId: string; concernId: string; statement: string; photos: UploadedFile[]; videos: UploadedFile[] },
  now = new Date(),
) {
  const c = await loadConcern(p.concernId);
  if (c.respondentId !== p.userId) throw new ForbiddenError("Only the other student can answer this case.");
  if (!OPEN_STATUSES.includes(c.status as (typeof OPEN_STATUSES)[number])) throw new ValidationError("This case has already been decided.");
  if (c.respondedAt) throw new ValidationError("You have already answered this case.");
  const problems = evidenceProblems(evidenceRequirement(c.kind as ConcernKindName, "RESPONDENT"), {
    statement: p.statement,
    photos: p.photos.length,
    videos: p.videos.length,
  });
  if (problems.length) throw new ValidationError(problems.join(" "));

  const respondentParty: PartyName = c.reporterParty === "RENTER" ? "OWNER" : "RENTER";
  const files = await storeFiles(c.id, p.userId, respondentParty, p.photos, p.videos);
  await prisma.concernEvidence.createMany({
    data: [{ concernId: c.id, authorId: p.userId, authorParty: respondentParty, type: "STATEMENT", text: p.statement.trim() }, ...files],
  });
  await prisma.concern.update({ where: { id: c.id }, data: { respondedAt: now, status: "UNDER_REVIEW" } });
  const late = now > c.responseDueAt;
  await event(c.id, "ANSWERED", respondentParty, `${respondentParty === "RENTER" ? "The renter" : "The owner"} answered${late ? " (after the 24 hours)" : ""}.`);
  await tell(
    io,
    c,
    c.reporter,
    "The other student answered",
    `${respondentParty === "RENTER" ? "The renter" : "The owner"} answered your report about ${c.rental.item.title} (case ${c.referenceNo}). ` +
      `You can see their side in the case. An admin now decides.`,
    true,
  );
  await tell(io, c, c.respondent, "Answer sent", `Your answer to case ${c.referenceNo} was sent. An admin now decides; you will be told here and by email.`, false);
  notifyAdmins(io, "admin:concern", { concernId: c.id, referenceNo: c.referenceNo, ready: true });
}

/** Ruling 6: after 24 h without an answer, the case goes to an admin anyway. */
export async function runConcernSweep(io: Server | undefined, now = new Date()): Promise<number> {
  const due = await prisma.concern.findMany({
    where: { status: "AWAITING_RESPONSE", responseDueAt: { lte: now } },
    include: { reporter: true, respondent: true, rental: { include: { item: true } } },
  });
  for (const c of due) {
    await prisma.concern.update({ where: { id: c.id }, data: { status: "UNDER_REVIEW" } });
    await event(c.id, "READY", "SYSTEM", "No answer within 24 hours: the case is with an admin to decide.");
    await tell(io, c, c.reporter, "Your case is with an admin", `The other student did not answer case ${c.referenceNo} within 24 hours, so an admin is deciding it now.`, false);
    await tell(io, c, c.respondent, "The case is with an admin", `You did not answer case ${c.referenceNo} within 24 hours. An admin is deciding it now; you can still add your side until they do.`, true);
    notifyAdmins(io, "admin:concern", { concernId: c.id, referenceNo: c.referenceNo, ready: true });
  }
  return due.length;
}

// ── reading a case ─────────────────────────────────────────────────────────

function nextStep(
  c: { status: string; kind: string; respondedAt: Date | null; responseDueAt: Date; amountOwed: number | null; owedPaidAt: Date | null },
  viewer: "REPORTER" | "RESPONDENT",
  paymentSent = false,
): string {
  switch (c.status) {
    case "AWAITING_RESPONSE":
      return viewer === "RESPONDENT"
        ? `Give your side with a statement and, if you can, photos or a video, before ${when(c.responseDueAt)}. An admin decides after that.`
        : `The other student can answer until ${when(c.responseDueAt)}. Then an admin decides.`;
    case "UNDER_REVIEW":
      return "An admin is looking at both sides and will decide soon. You will be told here and by email.";
    case "CLOSED":
      return "This concern was settled together with the return check.";
    default:
      if (isSettled(c)) {
        const paid = (c.amountOwed ?? 0) > 0 && c.owedPaidAt;
        if (viewer === "RESPONDENT") {
          return paid
            ? `Settled. Your ${peso(c.amountOwed ?? 0)} payment was confirmed on ${when(c.owedPaidAt as Date)} and the limit on your account is lifted. Nothing more to do. The decision stays on record as upheld: it says who was responsible for the damage, not that anything is still owed.`
            : "Settled. The cost was covered by the deposit. Nothing more to do. The decision stays on record as upheld: it says who was responsible for the damage, not that anything is still owed.";
        }
        return paid
          ? `Settled. The renter paid the ${peso(c.amountOwed ?? 0)} they owed (confirmed ${when(c.owedPaidAt as Date)}); staff pay it out to you. Nothing more to do.`
          : "Settled. The cost was taken from the renter's deposit and paid to you. Nothing more to do.";
      }
      if ((c.amountOwed ?? 0) > 0 && !c.owedPaidAt) {
        // Sent but not yet confirmed: still "pay what you owe" read as if the
        // payment had been lost (seen on the emulator 2026-10-13).
        if (paymentSent) {
          return viewer === "RESPONDENT" && c.kind === "DAMAGE_ON_RETURN"
            ? "Your payment was sent. Staff confirm it within 24 hours; the limit on your account lifts then."
            : `The renter has sent the ${peso(c.amountOwed ?? 0)}; staff are confirming it.`;
        }
        return viewer === "RESPONDENT" && c.kind === "DAMAGE_ON_RETURN"
          ? `Pay the ${peso(c.amountOwed ?? 0)} you owe to lift the limit on your account.`
          : `The renter still owes ${peso(c.amountOwed ?? 0)}.`;
      }
      // An upheld defect pauses the owner's listing and moves the return date
      // forward; say what each of them does now, not just "decided".
      if (c.kind === "DEFECT_ON_RECEIPT" && (c.status === "UPHELD" || c.status === "PARTLY_UPHELD")) {
        return viewer === "RESPONDENT"
          ? "Your listing is paused because of this decision. Once the item is fixed, tell an admin through Profile > Send Feedback and they will list it again."
          : "Return the item at the kiosk by the date in the decision below; there is no late fee. The rent given back is shown below.";
      }
      return "This case is decided.";
  }
}

export async function concernForParty(concernId: string, userId: string) {
  const c = await prisma.concern.findUnique({
    where: { id: concernId },
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true } },
      respondent: { select: { id: true, firstName: true, lastName: true } },
      rental: { select: { id: true, renterId: true, ownerId: true, item: { select: { title: true } }, endDate: true, status: true } },
      evidence: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!c) throw new NotFoundError("Case not found");
  const role = c.reporterId === userId ? "REPORTER" : c.respondentId === userId ? "RESPONDENT" : null;
  if (!role) throw new ForbiddenError("Access denied");
  const pendingPayment = await prisma.transaction.findFirst({
    where: { rentalId: c.rentalId, type: "DAMAGE_PAYMENT", status: "PENDING", paymentDetails: { path: "$.concernId", equals: c.id } },
    select: { id: true, amount: true, paymentReferenceNo: true, createdAt: true },
  });
  return {
    id: c.id,
    referenceNo: c.referenceNo,
    kind: c.kind,
    title: KIND_TITLE[c.kind as ConcernKindName],
    status: c.status,
    viewerRole: role,
    viewerParty: c.rental.renterId === userId ? "RENTER" : "OWNER",
    itemTitle: c.rental.item.title,
    rentalId: c.rentalId,
    reporter: c.reporter,
    reporterParty: c.reporterParty,
    respondent: c.respondent,
    responseDueAt: c.responseDueAt,
    respondedAt: c.respondedAt,
    canRespond: role === "RESPONDENT" && !c.respondedAt && OPEN_STATUSES.includes(c.status as (typeof OPEN_STATUSES)[number]),
    respondRequirement: evidenceRequirement(c.kind as ConcernKindName, "RESPONDENT"),
    nextStep: nextStep(c, role, pendingPayment != null),
    settled: isSettled(c),
    decision: c.decidedAt
      ? {
          decidedAt: c.decidedAt,
          responsibilityPct: c.responsibilityPct,
          assessedAmount: c.assessedAmount,
          refundAmount: c.refundAmount,
          chargeAmount: c.chargeAmount,
          fromDeposit: c.fromDeposit,
          amountOwed: c.amountOwed,
          owedPaidAt: c.owedPaidAt,
          note: c.decisionNote,
        }
      : null,
    payment:
      (c.amountOwed ?? 0) > 0 && !c.owedPaidAt && role === "RESPONDENT"
        ? {
            amount: c.amountOwed,
            channel: env.PAYMENT_MANUAL_CHANNEL,
            accountName: env.PAYMENT_MANUAL_ACCOUNT_NAME ?? null,
            accountNumber: env.PAYMENT_MANUAL_ACCOUNT_NUMBER ?? null,
            reference: c.referenceNo,
            confirmWindow: env.PAYMENT_MANUAL_CONFIRM_WINDOW,
            pending: pendingPayment,
          }
        : null,
    evidence: c.evidence.map((e) => ({
      id: e.id,
      party: e.authorParty,
      mine: e.authorId === userId,
      type: e.type,
      text: e.text,
      url: e.path ? signedMediaUrl(e.path) : null,
      mime: e.mime,
      createdAt: e.createdAt,
    })),
    events: c.events.map((e) => ({ type: e.type, actor: e.actor, message: e.message, at: e.createdAt })),
  };
}

// ── admin ───────────────────────────────────────────────────────────────────

export async function adminListConcerns(filter: "open" | "decided" | "all" = "open") {
  const where: Prisma.ConcernWhereInput =
    filter === "open" ? { status: { in: [...OPEN_STATUSES] } } : filter === "decided" ? { status: { notIn: [...OPEN_STATUSES] } } : {};
  const rows = await prisma.concern.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      reporter: { select: { firstName: true, lastName: true } },
      respondent: { select: { firstName: true, lastName: true } },
      rental: { select: { item: { select: { title: true } } } },
      evidence: { select: { type: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    referenceNo: c.referenceNo,
    kind: c.kind,
    title: KIND_TITLE[c.kind as ConcernKindName],
    status: c.status,
    itemTitle: c.rental.item.title,
    reporter: `${c.reporter.firstName} ${c.reporter.lastName}`,
    reporterParty: c.reporterParty,
    respondent: `${c.respondent.firstName} ${c.respondent.lastName}`,
    responseDueAt: c.responseDueAt,
    respondedAt: c.respondedAt,
    ready: c.status === "UNDER_REVIEW",
    photos: c.evidence.filter((e) => e.type === "PHOTO").length,
    videos: c.evidence.filter((e) => e.type === "VIDEO").length,
    amountOwed: c.amountOwed,
    owedPaidAt: c.owedPaidAt,
    settled: isSettled(c),
    repeatFlag: c.repeatFlag,
    createdAt: c.createdAt,
    decidedAt: c.decidedAt,
  }));
}

async function moneyFacts(c: ConcernWithPeople) {
  const tx = await prisma.transaction.findMany({ where: { rentalId: c.rentalId, status: "COMPLETED" } });
  const deposit = tx.find((t) => t.type === "SECURITY_DEPOSIT")?.amount ?? 0;
  const rent = tx.find((t) => t.type === "RENTAL_PAYMENT")?.amount ?? 0;
  const depositRefunded = (await prisma.transaction.count({ where: { rentalId: c.rentalId, type: "DEPOSIT_REFUND" } })) > 0;
  const deducted = tx.filter((t) => t.type === "DAMAGE_FEE" || t.type === "LATE_FEE" || t.type === "EXTENSION_FEE").reduce((s, t) => s + t.amount, 0);
  const depositAvailable = depositRefunded || !c.rental.depositHoldUntil ? 0 : round2(Math.max(0, deposit - deducted));
  const cap = damageCap(c.rental.item.replacementValue, c.rental.securityDeposit, c.rental.item.pricePerDay);
  return { deposit, rent, depositRefunded, depositAvailable, cap };
}

/** The numbers and the words of a decision, before it is made (and when it is). */
export async function previewDecision(concernId: string, pctIn: number, assessedIn?: number | null, now = new Date()) {
  const c = await loadConcern(concernId);
  const pct = clampPct(pctIn);
  const m = await moneyFacts(c);
  if (c.kind === "DEFECT_ON_RECEIPT") {
    const r = defectRefund({
      rent: m.rent,
      startDate: c.rental.startDate,
      endDate: c.rental.endDate,
      claimedAt: c.rental.claimedAt,
      reportedAt: c.createdAt,
      responsibilityPct: pct,
    });
    const returnBy =
      pct > 0 && c.rental.status === "ACTIVE"
        ? new Date(Math.min(c.rental.endDate.getTime(), now.getTime() + EARLY_RETURN_HOURS * HOUR))
        : null;
    return {
      kind: c.kind,
      status: decisionStatus(pct),
      pct,
      refund: r.refund,
      refundBase: r.base,
      fullBecauseEarly: r.fullBecauseEarly,
      returnBy,
      explanation: explainDecision("DEFECT_ON_RECEIPT", pct, { refund: r.refund, fullBecauseEarly: r.fullBecauseEarly }, returnBy),
      facts: m,
    };
  }
  if (c.kind === "DAMAGE_ON_RETURN") {
    const o = damageOutcome({
      assessedAmount: assessedIn ?? 0,
      cap: m.cap.cap,
      responsibilityPct: pct,
      depositAvailable: m.depositAvailable,
    });
    return {
      kind: c.kind,
      status: decisionStatus(pct),
      pct,
      ...o,
      explanation: explainDecision("DAMAGE_ON_RETURN", pct, o),
      facts: m,
    };
  }
  return { kind: c.kind, status: "CLOSED", pct: 0, explanation: explainDecision("RETURN_CHECK", 0, {}), facts: m };
}

export async function adminGetConcern(concernId: string) {
  const c = await prisma.concern.findUnique({
    where: { id: concernId },
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true, email: true, studentId: true } },
      respondent: { select: { id: true, firstName: true, lastName: true, email: true, studentId: true } },
      rental: {
        include: {
          item: { select: { id: true, title: true, images: true, replacementValue: true, pricePerDay: true, securityDeposit: true } },
          depositVerification: { select: { kioskImages: true, createdAt: true } },
          verification: { select: { kioskImages: true, createdAt: true } },
        },
      },
      evidence: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!c) throw new NotFoundError("Case not found");
  const preview = await previewDecision(concernId, c.responsibilityPct ?? (c.kind === "RETURN_CHECK" ? 0 : 100), c.assessedAmount ?? null);
  const pendingPayment = await prisma.transaction.findFirst({
    where: { rentalId: c.rentalId, type: "DAMAGE_PAYMENT", status: "PENDING", paymentDetails: { path: "$.concernId", equals: c.id } },
  });
  const since = new Date(Date.now() - REPEAT_WINDOW_DAYS * 24 * HOUR);
  const priorUpheld = await prisma.concern.count({
    where: {
      respondentId: c.respondentId,
      id: { not: c.id },
      kind: { in: ["DEFECT_ON_RECEIPT", "DAMAGE_ON_RETURN"] },
      status: { in: ["UPHELD", "PARTLY_UPHELD"] },
      decidedAt: { gte: since },
    },
  });
  return {
    ...c,
    title: KIND_TITLE[c.kind as ConcernKindName],
    evidence: c.evidence.map((e) => ({ ...e, url: e.path ? signedMediaUrl(e.path) : null })),
    // Locker photos already on file, under the keys the media rewriter re-signs.
    lockerPhotos: {
      deposit: { kioskImages: c.rental.depositVerification?.kioskImages ?? [], at: c.rental.depositVerification?.createdAt ?? null },
      return: { kioskImages: c.rental.verification?.kioskImages ?? [], at: c.rental.verification?.createdAt ?? null },
      listing: { images: c.rental.item.images },
    },
    preview,
    pendingPayment,
    settled: isSettled(c),
    priorUpheldAgainstRespondent: priorUpheld,
  };
}

export async function decideConcern(
  io: Server | undefined,
  concernId: string,
  adminId: string,
  p: { pct: number; assessedAmount?: number | null; note: string },
  now = new Date(),
) {
  const c = await loadConcern(concernId);
  if (!OPEN_STATUSES.includes(c.status as (typeof OPEN_STATUSES)[number])) throw new ValidationError("This case has already been decided.");
  const note = (p.note ?? "").trim();
  if (note.length < 20) throw new ValidationError("Write at least 20 characters explaining the decision; both students read it.");
  const pv = await previewDecision(concernId, p.pct, p.assessedAmount ?? null, now);
  const pct = pv.pct;
  const item = c.rental.item.title;

  if (c.kind === "RETURN_CHECK") {
    await prisma.concern.update({ where: { id: c.id }, data: { status: "CLOSED", decidedAt: now, decidedById: adminId, decisionNote: note } });
    await event(c.id, "CLOSED", "ADMIN", `Closed by an admin: ${note}`);
    for (const u of [c.reporter, c.respondent]) {
      await tell(io, c, u, "Concern closed", `An admin closed concern ${c.referenceNo} about ${item}: ${note}`, true);
    }
    return;
  }

  if (c.kind === "DEFECT_ON_RECEIPT") {
    const refund = (pv as { refund: number }).refund;
    const returnBy = (pv as { returnBy: Date | null }).returnBy;
    if (refund > 0) {
      const payTx = await prisma.transaction.findFirst({
        where: { rentalId: c.rentalId, type: "RENTAL_PAYMENT", status: "COMPLETED" },
      });
      let method = "Ledger (staff refund the renter by hand)";
      if (payTx?.paymongoPaymentId && env.PAYMONGO_SECRET_KEY) {
        try {
          await createRefund({ paymentId: payTx.paymongoPaymentId, amount: refund, reason: "others" });
          method = "PayMongo";
        } catch (err) {
          logger.error(`[CONCERN] PayMongo rent refund failed for ${c.referenceNo}; recorded for a manual refund`, err);
        }
      }
      await prisma.transaction.create({
        data: {
          rentalId: c.rentalId,
          userId: c.rental.renterId,
          type: "RENTAL_REFUND",
          amount: refund,
          status: "COMPLETED",
          paidAt: now,
          paymentMethod: method,
          paymentDetails: { concernId: c.id, referenceNo: c.referenceNo },
        },
      });
    }
    if (returnBy) await prisma.rental.update({ where: { id: c.rentalId }, data: { endDate: returnBy } });
    if (pct > 0) {
      await prisma.item.update({
        where: { id: c.rental.itemId },
        data: {
          isListed: false,
          isFlagged: true,
          flagReason: `Defect upheld in case ${c.referenceNo} (${pct}% owner responsibility). Paused until the owner tells an admin it is fixed; list it again from Items.`,
        },
      });
    }
    await prisma.concern.update({
      where: { id: c.id },
      data: { status: pv.status as "UPHELD" | "PARTLY_UPHELD" | "NOT_UPHELD", decidedAt: now, decidedById: adminId, responsibilityPct: pct, refundAmount: refund, decisionNote: note },
    });
  }

  if (c.kind === "DAMAGE_ON_RETURN") {
    const o = pv as unknown as { assessed: number; charge: number; fromDeposit: number; owed: number };
    if (o.fromDeposit > 0) {
      await prisma.transaction.create({
        data: {
          rentalId: c.rentalId,
          userId: c.rental.renterId,
          type: "DAMAGE_FEE",
          amount: o.fromDeposit,
          status: "COMPLETED",
          paidAt: now,
          paymentMethod: "Deducted from the held deposit",
          paymentDetails: { concernId: c.id, referenceNo: c.referenceNo },
        },
      });
      await prisma.transaction.create({
        data: {
          rentalId: c.rentalId,
          userId: c.rental.ownerId,
          type: "OWNER_PAYOUT",
          amount: o.fromDeposit,
          status: "PENDING",
          paymentMethod: "Damage compensation (staff pay out)",
          paymentDetails: { concernId: c.id, referenceNo: c.referenceNo },
        },
      });
    }
    await releaseHeldDeposit(c.rentalId, `damage case ${c.referenceNo} decided`);
    await prisma.concern.update({
      where: { id: c.id },
      data: {
        status: pv.status as "UPHELD" | "PARTLY_UPHELD" | "NOT_UPHELD",
        decidedAt: now,
        decidedById: adminId,
        responsibilityPct: pct,
        assessedAmount: o.assessed,
        chargeAmount: o.charge,
        fromDeposit: o.fromDeposit,
        amountOwed: o.owed,
        decisionNote: note,
      },
    });
  }

  // Ruling 7: two upheld cases against the same student within 90 days.
  let repeat = false;
  if (pct > 0) {
    const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * 24 * HOUR);
    const upheld = await prisma.concern.count({
      where: {
        respondentId: c.respondentId,
        kind: { in: ["DEFECT_ON_RECEIPT", "DAMAGE_ON_RETURN"] },
        status: { in: ["UPHELD", "PARTLY_UPHELD"] },
        decidedAt: { gte: since },
      },
    });
    if (upheld >= REPEAT_THRESHOLD) {
      repeat = true;
      await prisma.concern.update({ where: { id: c.id }, data: { repeatFlag: true } });
      await prisma.auditLog.create({
        data: {
          actorId: adminId,
          actorEmail: "system",
          actorRole: "ADMIN",
          action: "concern.repeat_flag",
          targetType: "user",
          targetId: c.respondentId,
          reason: `${upheld} upheld cases in ${REPEAT_WINDOW_DAYS} days (latest ${c.referenceNo}).`,
        },
      });
      notifyAdmins(io, "admin:concern", { concernId: c.id, referenceNo: c.referenceNo, repeat: true });
    }
  }

  const explanation = pv.explanation;
  await event(c.id, "DECIDED", "ADMIN", `${explanation} Admin's note: ${note}`);
  const text = `Decision on case ${c.referenceNo} (${item}). ${explanation}\n\nThe admin's explanation: ${note}`;
  await tell(io, c, c.reporter, "Your case has been decided", text, true);
  await tell(io, c, c.respondent, "A case about you has been decided", text, true);
  logger.info(`[CONCERN] ${c.referenceNo} decided: ${pv.status} ${pct}%${repeat ? " (repeat flag)" : ""}`);
}

// ── paying what is owed (damage above the deposit) ─────────────────────────

export async function owedConcernFor(userId: string) {
  return prisma.concern.findFirst({
    where: { respondentId: userId, kind: "DAMAGE_ON_RETURN", amountOwed: { gt: 0 }, owedPaidAt: null },
    orderBy: { decidedAt: "asc" },
    select: { id: true, referenceNo: true, amountOwed: true, rentalId: true },
  });
}

export async function submitOwedPayment(io: Server | undefined, concernId: string, userId: string, reference: string) {
  const c = await loadConcern(concernId);
  if (c.respondentId !== userId || c.kind !== "DAMAGE_ON_RETURN") throw new ForbiddenError("Access denied");
  if (!c.amountOwed || c.amountOwed <= 0 || c.owedPaidAt) throw new ValidationError("Nothing is owed on this case.");
  const ref = reference.trim();
  if (ref.length < 4) throw new ValidationError("Enter the reference number of your payment.");
  const pending = await prisma.transaction.findFirst({
    where: { rentalId: c.rentalId, type: "DAMAGE_PAYMENT", status: "PENDING", paymentDetails: { path: "$.concernId", equals: c.id } },
  });
  if (pending) throw new ValidationError("Your payment is already waiting for staff to confirm it.");
  await prisma.transaction.create({
    data: {
      rentalId: c.rentalId,
      userId,
      type: "DAMAGE_PAYMENT",
      amount: c.amountOwed,
      status: "PENDING",
      paymentMethod: `${env.PAYMENT_MANUAL_CHANNEL} (manual)`,
      paymentReferenceNo: ref,
      paymentDetails: { concernId: c.id, referenceNo: c.referenceNo },
    },
  });
  await event(c.id, "PAYMENT_SUBMITTED", "RENTER", `The renter sent ${peso(c.amountOwed)} (reference ${ref}); waiting for staff to confirm.`);
  await tell(io, c, c.respondent, "Payment sent for checking", `Staff will confirm your ${peso(c.amountOwed)} payment for case ${c.referenceNo} ${env.PAYMENT_MANUAL_CONFIRM_WINDOW}. Your account stays limited until then.`, false);
  notifyAdmins(io, "admin:concern", { concernId: c.id, referenceNo: c.referenceNo, payment: true });
}

export async function confirmOwedPayment(io: Server | undefined, concernId: string, adminId: string, now = new Date()) {
  const c = await loadConcern(concernId);
  const tx = await prisma.transaction.findFirst({
    where: { rentalId: c.rentalId, type: "DAMAGE_PAYMENT", status: "PENDING", paymentDetails: { path: "$.concernId", equals: c.id } },
  });
  if (!tx) throw new ValidationError("No payment is waiting on this case.");
  await prisma.transaction.update({ where: { id: tx.id }, data: { status: "COMPLETED", paidAt: now } });
  await prisma.transaction.create({
    data: {
      rentalId: c.rentalId,
      userId: c.rental.ownerId,
      type: "OWNER_PAYOUT",
      amount: tx.amount,
      status: "PENDING",
      paymentMethod: "Damage compensation (staff pay out)",
      paymentDetails: { concernId: c.id, referenceNo: c.referenceNo },
    },
  });
  await prisma.concern.update({ where: { id: c.id }, data: { owedPaidAt: now } });
  await event(c.id, "PAYMENT_CONFIRMED", "ADMIN", `Staff confirmed the ${peso(tx.amount)} payment.`);
  await tell(io, c, c.respondent, "Payment confirmed", `Your ${peso(tx.amount)} payment for case ${c.referenceNo} is confirmed. The limit on your account is lifted.`, true);
  await tell(io, c, c.reporter, "The renter paid", `The renter paid the ${peso(tx.amount)} they owed for case ${c.referenceNo}. It will be paid out to you.`, true);
  logger.info(`[CONCERN] ${c.referenceNo}: owed payment confirmed by admin ${adminId}`);
}

// ── the return check decides a RETURN_CHECK concern ────────────────────────

export async function closeReturnCheckConcerns(io: Server | undefined, rentalId: string, outcome: "APPROVED" | "REJECTED") {
  const open = await prisma.concern.findMany({
    where: { rentalId, kind: "RETURN_CHECK", status: { in: [...OPEN_STATUSES] } },
    include: { reporter: true, respondent: true, rental: { include: { item: true } } },
  });
  for (const c of open ?? []) {
    const text =
      outcome === "APPROVED"
        ? `An admin checked the return of ${c.rental.item.title} with your concern ${c.referenceNo} in view and APPROVED it. ` +
          `If the owner later finds damage the camera could not see, they can still report it from the rental.`
        : `An admin checked the return of ${c.rental.item.title} with concern ${c.referenceNo} in view and REJECTED it. A dispute case has been opened; see the rental.`;
    await prisma.concern.update({ where: { id: c.id }, data: { status: "CLOSED", decidedAt: new Date() } });
    await event(c.id, "CLOSED", "ADMIN", `The return check was ${outcome === "APPROVED" ? "approved" : "rejected"}.`);
    await tell(io, c, c.reporter, "Your concern was settled", text, true);
    await tell(io, c, c.respondent, "A concern was settled", text, false);
  }
}
