import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";
import { getRestriction } from "../services/disputeService";

/**
 * Dispute v2, ruling 3 — the renter's account is RESTRICTED while a case is
 * open (and, after a second wrong item, until an admin reviews it).
 *
 * Restricted, not locked: the return itself needs the app's QR + face, so the
 * login, the case, collecting their own item, paying and returning the correct
 * item all stay open. What this blocks is anything NEW: booking, extending,
 * listing, and paying for new bookings.
 *
 * This is the SERVER's rule. The app's full-screen prompt mirrors it for
 * clarity, and must never be described as the boundary.
 */
export const blockIfRestricted = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    if (req.user.role !== "STUDENT") return next();
    const r = await getRestriction(req.user.userId);
    if (r.restricted) {
      const err = new ForbiddenError(
        `${r.reason} Until it is resolved you can only view the case, collect your own item, pay, return the correct item, and request a review or contact support.`,
      ) as ForbiddenError & { code?: string; disputeId?: string | null };
      err.code = "ACCOUNT_RESTRICTED";
      err.disputeId = r.disputeId;
      throw err;
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** `rentalId` for the kiosk steps: a rental UUID, or `wi:<disputeId>` (a renter collecting their own wrong item). */
export function isKioskTarget(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuid.test(value) || (value.startsWith("wi:") && uuid.test(value.slice(3)));
}
