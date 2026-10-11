import type { Server } from "socket.io";
import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import logger from "../utils/logger";
import { sendEmail } from "../utils/email";

/**
 * Dispute v2 — the case record's writers: reference numbers, the event log,
 * and every message to the renter or the owner.
 *
 * Ruling 14: the admin sees ALL case data and the EXACT messages the renter and
 * the owner were shown. So no dispute message is sent any other way than
 * `tellParty`, which writes the notification AND logs the same words, in the
 * same call, as a DisputeEvent. An email is logged only if it really went.
 */

export type ActorRole = "SYSTEM" | "ADMIN" | "RENTER" | "OWNER" | "KIOSK";
export type Audience = "RENTER" | "OWNER" | "ADMIN" | "GUARDIAN" | "SAO" | "ENGINEERING" | "GUIDANCE";

export async function recordEvent(
  disputeId: string,
  e: {
    type: string;
    actorRole: ActorRole;
    actorId?: string | null;
    audience?: Audience | null;
    channel?: string | null;
    title?: string | null;
    message?: string | null;
    outcome?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await prisma.disputeEvent.create({
      data: {
        disputeId,
        type: e.type,
        actorRole: e.actorRole,
        actorId: e.actorId ?? null,
        audience: e.audience ?? null,
        channel: e.channel ?? null,
        title: e.title ?? null,
        message: e.message ?? null,
        outcome: e.outcome ?? null,
        metadata: (e.metadata ?? undefined) as never,
      },
    });
  } catch (err) {
    // The case log must not take down the action it describes; it is loud.
    logger.error(`[DISPUTE] could not record event ${e.type} on ${disputeId}:`, err);
  }
}

/** Next `PREFIX-YYYY-NNNN`. Retried on the (rare) unique collision. */
export async function nextReference(kind: "DSP" | "LTR", now = new Date()): Promise<string> {
  const prefix = `ER-${kind}-${now.getFullYear()}-`;
  const count =
    kind === "DSP"
      ? await prisma.dispute.count({ where: { referenceNo: { startsWith: prefix } } })
      : await prisma.disputeLetter.count({ where: { referenceNo: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

/** Create with a fresh reference, retrying on a unique-key race. */
export async function withReference<T>(
  kind: "DSP" | "LTR",
  create: (referenceNo: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = await nextReference(kind);
    const candidate = attempt === 0 ? ref : `${ref}-${attempt}`;
    try {
      return await create(candidate);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error(`Could not allocate a ${kind} reference number`);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text (paragraphs separated by blank lines) to a simple HTML email. */
export function textToHtml(title: string, text: string): string {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  return `<h2>${escapeHtml(title)}</h2>\n${paras}\n<p style="color:#666">EngiRent Hub, in partnership with the University of Cebu Lapu-Lapu and Mandaue (UCLM)</p>`;
}

/**
 * Tell the renter or the owner something about their case. In-app always;
 * email when asked. Every word is logged on the case as it was sent.
 */
export async function tellParty(
  io: Server | undefined,
  dispute: { id: string; rentalId: string; renterId: string; ownerId: string; referenceNo: string },
  audience: "RENTER" | "OWNER",
  title: string,
  message: string,
  opts: { email?: boolean; type?: string; actorRole?: ActorRole; actorId?: string | null } = {},
): Promise<void> {
  const userId = audience === "RENTER" ? dispute.renterId : dispute.ownerId;
  await prisma.notification.create({
    data: {
      userId,
      title,
      message,
      type: "DISPUTE_UPDATE",
      relatedEntityId: dispute.rentalId,
      relatedEntityType: "rental",
    },
  });
  await recordEvent(dispute.id, {
    type: opts.type ?? "MESSAGE",
    actorRole: opts.actorRole ?? "SYSTEM",
    actorId: opts.actorId ?? null,
    audience,
    channel: "IN_APP",
    title,
    message,
  });

  if (opts.email) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user) {
      const sent = await sendEmail({
        to: user.email,
        subject: `${title} [${dispute.referenceNo}]`,
        html: textToHtml(title, message),
        text: message,
      });
      await recordEvent(dispute.id, {
        type: opts.type ?? "MESSAGE",
        actorRole: opts.actorRole ?? "SYSTEM",
        audience,
        channel: "EMAIL",
        title,
        message: sent ? message : null,
        outcome: sent ? "SENT" : "NOT_SENT (email is not configured or failed)",
      });
    }
  }

  io?.to(`user:${userId}`).emit("dispute:update", { disputeId: dispute.id, rentalId: dispute.rentalId });
}
