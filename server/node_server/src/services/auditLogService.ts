import prisma from "../config/database";
import { AuthRequest } from "../middleware/auth";
import logger from "../utils/logger";

/**
 * Checklist Stage 9 — a real, structured, queryable audit trail. Every
 * existing `logger.info("Admin X did Y to Z")` call already had this
 * information baked into one text line in logs/combined.log — not
 * queryable, not reachable through any API. This writes the same
 * information as real columns instead, alongside (not instead of) the
 * existing logger calls.
 *
 * Best-effort: a failed audit write must never fail the action it's
 * recording — an admin's moderation action succeeding is what matters;
 * losing one audit row to a transient DB hiccup is not worth rolling that
 * back or blocking the response for.
 */
export async function recordAudit(
  req: AuthRequest,
  params: {
    action: string;
    targetType: string;
    targetId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!req.user) return;
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.user.userId,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        reason: params.reason ?? null,
        metadata: params.metadata
          ? (params.metadata as unknown as object)
          : undefined,
      },
    });
  } catch (err) {
    logger.warn(`Failed to write audit log for ${params.action}:`, err);
  }
}
