import { Request, Response, NextFunction } from "express";
import env from "../config/env";
import { ForbiddenError } from "../utils/errors";

/**
 * HTTP-layer counterpart to the Socket.io `io.use()` kiosk-secret check in
 * index.ts — for the one thing the kiosk does over plain HTTP rather than
 * the socket connection: uploading captured images (POST /kiosk/upload).
 * Same shared secret, same fail-closed behavior when unconfigured.
 */
export function requireKioskSecret(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!env.KIOSK_SHARED_SECRET) {
    next(new ForbiddenError("Kiosk uploads are not configured (KIOSK_SHARED_SECRET unset)"));
    return;
  }
  const provided = req.headers["x-kiosk-secret"];
  if (provided !== env.KIOSK_SHARED_SECRET) {
    next(new ForbiddenError("Invalid kiosk credentials"));
    return;
  }
  next();
}
