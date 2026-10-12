import crypto from "crypto";
import prisma from "../config/database";
import env from "../config/env";
import { hashPassword } from "../utils/bcrypt";
import { sendEmail } from "../utils/email";
import { AppError, ValidationError } from "../utils/errors";
import logger from "../utils/logger";

/**
 * Forgot password (user request 2026-10-12, once email went live).
 *
 * A student asks for a 6-digit code by email and types it into the app with
 * a new password. Rules:
 *  - The reply to a request is the same whether or not the email has an
 *    account, so the form cannot be used to find out who is registered.
 *  - Only an HMAC of the code is stored (keyed by JWT_SECRET, bound to the
 *    user id), never the code itself, and the code is never logged (it was,
 *    once, through the subject line: found live 2026-10-12, fixed same hour).
 *  - A code dies after CODE_TTL_MINUTES, MAX_ATTEMPTS wrong tries, a newer
 *    request, or one successful use.
 *  - Resetting clears the stored refresh token, so other devices are signed
 *    out at their next refresh, and the student is told by email.
 */

export const CODE_TTL_MINUTES = 15;
export const MAX_ATTEMPTS = 5;
export const RESEND_GAP_SECONDS = 60;
export const MAX_CODES_PER_HOUR = 5;

export const GENERIC_REQUEST_REPLY =
  "If that email has an EngiRent account, a 6-digit code is on its way. It works for 15 minutes.";

export function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashCode(userId: string, code: string): string {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(`${userId}:${code}`).digest("hex");
}

export function codeMatches(userId: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(userId, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function emailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

const normalise = (email: string) => email.trim().toLowerCase();

/**
 * Sends a code when the account exists and is active. Always resolves the
 * same way for the caller; only a server with no email at all says so, and it
 * says so for every address alike.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  if (!emailConfigured()) {
    throw new AppError(503, "Password reset by email is not available right now. Please contact the EngiRent admin.");
  }

  const email = normalise(rawEmail);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, isActive: true },
  });
  if (!user || !user.isActive) return;

  const now = Date.now();
  const recent = await prisma.passwordResetCode.findMany({
    where: { userId: user.id, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent.length >= MAX_CODES_PER_HOUR) {
    logger.warn(`Password reset: hourly limit reached for ${user.email}`);
    return;
  }
  if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_GAP_SECONDS * 1000) {
    return; // the previous code is still fresh; the app shows a resend countdown
  }

  const code = generateCode();
  await prisma.$transaction([
    prisma.passwordResetCode.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date(now) },
    }),
    prisma.passwordResetCode.create({
      data: {
        userId: user.id,
        codeHash: hashCode(user.id, code),
        expiresAt: new Date(now + CODE_TTL_MINUTES * 60 * 1000),
      },
    }),
  ]);

  // Not awaited: an existing account must not answer slower than an unknown
  // one (Gmail takes ~4 s), or the delay itself tells who is registered. And
  // the code stays out of the subject: utils/email logs every subject line.
  void sendEmail({
    to: user.email,
    subject: "Your EngiRent Hub password reset code",
    html: `<h2>Hi ${user.firstName},</h2>
<p>Someone asked to reset the password for your EngiRent Hub account. Your code is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${code}</p>
<p>Type it in the app within ${CODE_TTL_MINUTES} minutes. It works once.</p>
<p>If this was not you, ignore this email: your password stays the same.</p>`,
    text: `Your EngiRent Hub password reset code is ${code}. It works for ${CODE_TTL_MINUTES} minutes, once. If this was not you, ignore this email.`,
  }).then((sent) =>
    logger.info(`Password reset code ${sent ? "emailed" : "NOT emailed (send failed)"} for ${user.email}`),
  );
}

/** Checks the code and sets the new password. Throws a 400 with a plain reason. */
export async function resetPasswordWithCode(rawEmail: string, code: string, newPassword: string): Promise<void> {
  const email = normalise(rawEmail);
  const expired = new ValidationError("That code has expired or was already used. Ask for a new one.");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, isActive: true },
  });
  if (!user || !user.isActive) throw expired;

  const row = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw expired;

  // Every try is counted BEFORE the comparison, atomically, so parallel
  // guesses cannot get past MAX_ATTEMPTS between a read and a write.
  const counted = await prisma.passwordResetCode.updateMany({
    where: { id: row.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) throw expired;
  const attempts = row.attempts + 1;

  if (!codeMatches(user.id, code.trim(), row.codeHash)) {
    const left = MAX_ATTEMPTS - attempts;
    if (left <= 0) {
      await prisma.passwordResetCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    }
    throw new ValidationError(
      left > 0
        ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`
        : "That code is not right, and it no longer works. Ask for a new one.",
    );
  }

  // Consume first; a second request racing with the same code finds it used.
  const consumed = await prisma.passwordResetCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) throw expired;
  const password = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { password, refreshToken: null } });
  logger.info(`Password reset with an emailed code: ${user.email}`);

  void sendEmail({
    to: user.email,
    subject: "Your EngiRent Hub password was changed",
    html: `<h2>Hi ${user.firstName},</h2>
<p>The password for your EngiRent Hub account was just changed using a code sent to this email.</p>
<p>If this was not you, reply to this email or contact the EngiRent admin right away.</p>`,
  });
}
