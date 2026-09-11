import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import {
  ForbiddenError,
  GoneError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
import logger from "../utils/logger";
import kioskEventBus from "../utils/kioskEventBus";
import { recordAudit } from "../services/auditLogService";
import { emitLockerOccupancy } from "../services/lockerOccupancyService";
import {
  signedMediaUrl,
  saveBuffer,
  verificationImagePath,
} from "../services/storageService";
import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  KIOSK_ACTIONABLE_STATUSES,
  resolveFaceSubject,
  compareFaceWithMl,
  applyFaceVerificationOutcome,
} from "../services/faceVerificationService";
import {
  getKioskSession,
  consumeKioskSession,
  recordFailedFaceAttempt,
} from "../services/kioskSessionStore";

/**
 * POST /kiosk/deposit
 * Called by the mobile app to initiate a deposit.
 * Validates the rental, marks the locker reserved, then commands the Pi to
 * open the door.  Actual ML verification happens in the kiosk:images socket
 * handler (index.ts) when the Pi sends back captured image URLs.
 */
export const depositItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const { rentalId, lockerId } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true },
    });

    if (!rental) throw new NotFoundError("Rental not found");
    if (rental.ownerId !== req.user.userId)
      throw new ForbiddenError("Only the owner can deposit the item");
    if (rental.status !== "AWAITING_DEPOSIT")
      throw new ValidationError("Rental is not awaiting deposit");

    const locker = lockerId
      ? await prisma.locker.findUnique({ where: { id: lockerId } })
      : await prisma.locker.findFirst({
          where: { status: "AVAILABLE", isOperational: true },
        });

    if (!locker || locker.status !== "AVAILABLE")
      throw new ValidationError("No available locker");

    // Reserve the locker
    await prisma.locker.update({
      where: { id: locker.id },
      data: {
        status: "RESERVED",
        currentRentalId: rentalId,
        lastUsedAt: new Date(),
      },
    });

    // Command Pi to open the insertion door
    const io = req.app.get("io");
    if (io) {
      // D-53: the bay is RESERVED from this instant, so it must stop showing
      // as free before the door even opens — a second student walking up
      // during the owner's 20s insertion window would otherwise be told the
      // bay is available.
      await emitLockerOccupancy(io, locker.kioskId);

      io.to(`kiosk:${locker.kioskId}`).emit("kiosk:command", {
        action: "open_door",
        locker_id: parseInt(locker.lockerNumber, 10),
        door: "main_door",
        rental_id: rentalId,
      });

      // After door — request image capture (Pi will emit kiosk:images back)
      setTimeout(() => {
        io.to(`kiosk:${locker.kioskId}`).emit("kiosk:command", {
          action: "capture_image",
          locker_id: parseInt(locker.lockerNumber, 10),
          num_frames: 3,
          rental_id: rentalId,
        });
      }, 20_000); // 20 s default — enough for owner to insert item
    }

    logger.info(
      `Deposit initiated: rental ${rentalId}, locker ${locker.lockerNumber}`,
    );

    res.json({
      success: true,
      message:
        "Locker opened. Place item inside — verification will begin automatically.",
      data: {
        locker: {
          id: locker.id,
          lockerNumber: locker.lockerNumber,
          kioskId: locker.kioskId,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /kiosk/claim, POST /kiosk/return — retired 2026-09-03.
 *
 * Both used to command the kiosk to run `capture_face` itself. That command
 * no longer exists on the kiosk (the face camera was physically removed —
 * design mandate §2.13; see server/kiosk/services/socket_client.py's
 * dispatch table), so as of that date these endpoints silently stopped
 * working: claim would emit a command the kiosk logs as unrecognised and
 * does nothing with, and — worse — return would still open the locker door
 * immediately (its `open_door` call has no verification gate of its own),
 * then wait forever for a `capture_face` reply that will never come.
 *
 * The real replacement is the QR-scan flow → POST /kiosk/verify-face (see
 * faceVerificationService.ts), which is what the app actually uses and
 * which does the whole claim/return sequence itself once the phone's
 * captured selfie verifies — see applyFaceVerificationOutcome's "claim" and
 * "return" branches for the equivalent logic, now gated on a real check
 * instead of dead hardware calls.
 *
 * Kept as named, callable functions (rather than deleted outright) only
 * because nothing in this repo currently calls them — grepped clean across
 * server/, client/, and docs/ — so there was nothing to migrate; a
 * hard failure here is safer than leaving them silently broken for
 * whatever future caller reaches for them.
 */
export const claimItem = async (
  _req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  next(
    new GoneError(
      "POST /kiosk/claim no longer works — the kiosk's face camera was removed. " +
        "Claiming an item now happens by scanning the kiosk's QR code in the app, " +
        "which opens a verification page on the phone.",
    ),
  );
};

export const returnItem = async (
  _req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  next(
    new GoneError(
      "POST /kiosk/return no longer works — the kiosk's face camera was removed. " +
        "Returning an item now happens by scanning the kiosk's QR code in the app, " +
        "which opens a verification page on the phone.",
    ),
  );
};

export const getAvailableLockers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { kioskId, size } = req.query;

    const where: Record<string, unknown> = {
      status: "AVAILABLE",
      isOperational: true,
    };
    if (kioskId) where.kioskId = kioskId;
    if (size) where.size = size;

    const lockers = await prisma.locker.findMany({
      where,
      orderBy: { lockerNumber: "asc" },
    });

    res.json({ success: true, data: { lockers } });
  } catch (error) {
    next(error);
  }
};

export const startKioskSession = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Not authenticated");

    const { token, kioskId } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) throw new ForbiddenError("User not found");

    // Forward validation to the Pi via Socket.io.
    // The Pi's socket_client handles "kiosk:session_validate" by checking the
    // token against its active QR token, then emits "kiosk_session_started"
    // to the local browser UI on success.
    const io = req.app.get("io");
    if (io) {
      io.to(`kiosk:${kioskId}`).emit("kiosk:session_validate", {
        token,
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
      });
    }

    kioskEventBus.emit("kiosk_session_start", {
      kioskId: kioskId as string,
      userId: user.id,
      token: token as string,
    });

    logger.info(
      `Kiosk session started: kiosk=${kioskId} user=${user.email}`,
    );

    res.json({
      success: true,
      message: "Session handshake sent to kiosk — stand in front of the camera",
      data: { kioskId, userId: user.id },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /kiosk/upload
 *
 * Receives locker-capture and face-capture images directly from the
 * Raspberry Pi over HTTP (multipart), authenticated via the shared kiosk
 * secret (see middleware/kioskAuth.ts) — not a user JWT, since the kiosk has
 * no user identity of its own.
 *
 * This replaces the kiosk uploading straight to Supabase. Once storage
 * moved to the PC's local filesystem, the Pi can no longer write to it
 * directly (they're different physical machines, connected over Tailscale,
 * not a shared filesystem) — the kiosk now POSTs bytes here instead, the
 * same way any other client would.
 *
 * Verification/face-capture images are all treated as sensitive (evidence
 * tied to a specific rental's dispute/audit trail, or a live biometric
 * capture) — every URL returned is a short-lived signed one, never a
 * permanent/guessable link.
 */
export const uploadKioskImages = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ success: false, message: "No images provided" });
      return;
    }

    const rentalId = (req.body.rentalId as string | undefined)?.trim();
    // Rental-scoped when we know the rental (the overwhelming majority of
    // calls); falls back to an "unscoped" bucket for admin-preview snapshots
    // that have no associated rental (kiosk:admin_snapshot).
    const scope = rentalId && rentalId.length > 0 ? rentalId : "unscoped";

    const urls = await Promise.all(
      files.map(async (file) => {
        const ext = file.mimetype === "image/png" ? ".png" : ".jpg";
        const filename = `${Date.now()}-${uuidv4()}${ext}`;
        const relativePath = verificationImagePath(scope, filename);
        await saveBuffer(relativePath, file.buffer);
        return signedMediaUrl(relativePath);
      }),
    );

    res.json({ success: true, urls });
  } catch (error) {
    next(error);
  }
};

/**
 * D-63. Every locker with its CANONICAL state, for the admin console.
 *
 * This did not exist, and its absence is the root of two defects.
 * `getAvailableLockers` hard-filters `status: AVAILABLE, isOperational: true`
 * and returns only those rows, so **no endpoint carried `Locker.status` to any
 * client at all**. The kiosk admin page therefore offers "Release Locker" —
 * which clears the occupied state and detaches a rental — while showing only
 * door lock state, which cannot answer whether the bay is genuinely stuck.
 * The operator was deciding blind.
 *
 * Deliberately NOT a change to `getAvailableLockers`: the Flutter booking flow
 * and `assignLockerAndOpen` both depend on that filter meaning exactly what it
 * says, and widening it would quietly change which lockers the system offers.
 *
 * `currentRentalId` is included because it is the other half of the question:
 * a bay marked OCCUPIED with no rental attached is precisely the "stuck"
 * case this page's support action exists for. The renter's identity is NOT
 * included — an admin deciding whether hardware is stuck does not need it.
 */
export const listAllLockers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { kioskId } = req.query;
    const lockers = await prisma.locker.findMany({
      where: kioskId ? { kioskId: kioskId as string } : {},
      orderBy: { lockerNumber: "asc" },
      select: {
        id: true,
        lockerNumber: true,
        kioskId: true,
        size: true,
        status: true,
        isOperational: true,
        currentRentalId: true,
        lastUsedAt: true,
      },
    });
    res.json({ success: true, data: { lockers } });
  } catch (error) {
    next(error);
  }
};

export const releaseLocker = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const lockerId = req.params.id as string;

    const locker = await prisma.locker.findUnique({ where: { id: lockerId } });
    if (!locker) throw new NotFoundError("Locker not found");
    if (!locker.isOperational)
      throw new ValidationError("Locker is not operational");

    // Ownership check — this previously accepted a request from *any*
    // authenticated student regardless of whose rental (if any) occupied the
    // locker, despite the route comment claiming "admin or kiosk service."
    // Admins may always release a locker. Otherwise the caller must be the
    // renter or owner of the rental currently occupying it. A locker with no
    // current rental has nothing for a non-admin to legitimately release.
    if (req.user.role !== "ADMIN") {
      if (!locker.currentRentalId) {
        throw new ForbiddenError(
          "Only an admin can release a locker with no active rental",
        );
      }
      const rental = await prisma.rental.findUnique({
        where: { id: locker.currentRentalId },
        select: { renterId: true, ownerId: true },
      });
      if (
        !rental ||
        (rental.renterId !== req.user.userId &&
          rental.ownerId !== req.user.userId)
      ) {
        throw new ForbiddenError(
          "You can only release a locker tied to your own rental",
        );
      }
    }

    await prisma.locker.update({
      where: { id: lockerId },
      data: { status: "AVAILABLE", currentRentalId: null },
    });

    logger.info(`Locker ${locker.lockerNumber} released`);
    // D-53. `req.app?.get` rather than `req.app.get`: releaseLocker's unit
    // tests construct a bare AuthRequest with no Express app on it, and a
    // status push is not worth turning those into integration tests over.
    await emitLockerOccupancy(req.app?.get("io"), locker.kioskId);
    // Checklist Stage 9 — only the admin/support case is audited here; a
    // renter or owner releasing the locker tied to their own rental is
    // normal product flow, not an admin action worth a trail entry.
    if (req.user.role === "ADMIN") {
      await recordAudit(req, {
        action: "kiosk.releaseLocker",
        targetType: "kiosk",
        targetId: lockerId,
        metadata: { lockerNumber: locker.lockerNumber, hadRental: !!locker.currentRentalId },
      });
    }
    res.json({
      success: true,
      message: `Locker ${locker.lockerNumber} released`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /admin/kiosks/lockers/by-number/:lockerNumber/release — checklist
 * Stage 9's admin kiosk page. The kiosk admin UI works entirely in terms
 * of locker *numbers* (it talks to hardware over the live command/SSE
 * layer, never loading raw `Locker` rows with their database ids), so it
 * has no `Locker.id` to call [releaseLocker] with directly. Admin-only —
 * unlike [releaseLocker], there's no renter/owner self-service path here.
 */
export const releaseLockerByNumber = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const lockerNumber = req.params.lockerNumber as string;
    const locker = await prisma.locker.findUnique({ where: { lockerNumber } });
    if (!locker) throw new NotFoundError("Locker not found");
    if (!locker.isOperational)
      throw new ValidationError("Locker is not operational");

    await prisma.locker.update({
      where: { id: locker.id },
      data: { status: "AVAILABLE", currentRentalId: null },
    });

    logger.info(`Locker ${locker.lockerNumber} released (by number, admin)`);
    // D-53: an admin force-releasing a bay is exactly the case where the
    // panel must not keep showing the old state.
    await emitLockerOccupancy(req.app?.get("io"), locker.kioskId);
    await recordAudit(req, {
      action: "kiosk.releaseLocker",
      targetType: "kiosk",
      targetId: locker.id,
      metadata: { lockerNumber: locker.lockerNumber, hadRental: !!locker.currentRentalId },
    });

    res.json({
      success: true,
      message: `Locker ${locker.lockerNumber} released`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /kiosk/verify-face
 *
 * The phone-side replacement for the kiosk's removed face camera
 * (design mandate §2.13). The app uploads a freshly captured selfie; this
 * endpoint decides whether it matches the enrolled identity and, if so, opens
 * the locker.
 *
 * The app sends an **image**, never a verdict — see faceVerificationService.ts
 * for why that distinction is the whole security model of this endpoint.
 *
 * Bound to a live kiosk session: the caller must pass the QR token they just
 * scanned, and it must still be inside the kiosk's 90 s TTL. That is what stops
 * a verification from being replayed later, away from the kiosk, and it is why
 * the token is re-checked here rather than trusted from the earlier scan.
 */
export const verifyFaceFromApp = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    if (!req.file) throw new ValidationError("A face image is required");

    const { rentalId } = req.body as { rentalId?: string };
    if (!rentalId) throw new ValidationError("rentalId is required");

    // The kioskId is deliberately NOT taken from anything the client sends.
    // It comes only from a session the kiosk itself opened — see
    // kioskSessionStore.ts for why that's the whole security model here. No
    // session means either nobody scanned a QR for this rental recently, or
    // the 120s window since they did has closed.
    const session = getKioskSession(rentalId);
    if (!session) {
      throw new ValidationError(
        "No active kiosk session for this rental — scan the kiosk QR code again",
      );
    }
    if (session.userId !== req.user.userId) {
      throw new ForbiddenError(
        "You are not the person this step requires verification from",
      );
    }

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: {
        owner: { select: { profileImage: true, faceEncoding: true } },
        renter: { select: { profileImage: true, faceEncoding: true } },
      },
    });
    if (!rental) throw new NotFoundError("Rental not found");

    if (!KIOSK_ACTIONABLE_STATUSES.includes(rental.status as never)) {
      throw new ValidationError(
        `Rental status "${rental.status}" is not actionable at a kiosk`,
      );
    }

    // Whose face is required is derived from the rental's own state, never
    // from the request — otherwise the wrong party could open the locker.
    // (This is a second, independent check of the same fact the session's
    // userId already encodes — cheap, and it stays correct even if a rental
    // somehow changes status mid-session.)
    const subject = resolveFaceSubject(rental);
    if (subject.userId !== req.user.userId) {
      throw new ForbiddenError(
        "You are not the person this step requires verification from",
      );
    }
    if (!subject.storedEncoding && !subject.referenceFaceUrl) {
      throw new ValidationError(
        "No enrolled face on this account — finish profile setup first",
      );
    }

    let result;
    try {
      result = await compareFaceWithMl(
        req.file.buffer,
        req.file.mimetype,
        subject,
      );
    } catch (err) {
      // Fail closed. The kiosk's old local Haar-cascade fallback is gone on
      // purpose: a quietly weaker identity check is worse than a clear error.
      // The session is left open (not consumed, no attempt recorded) — an
      // ML outage isn't a bad match, and shouldn't burn the user's retry
      // budget or force them to rescan.
      logger.error(`Face verification unavailable for rental ${rentalId}:`, err);
      throw new ValidationError(
        "Verification service is unavailable right now — please try again in a moment",
      );
    }

    if (!result.verified) {
      const { exhausted, attemptsRemaining } = recordFailedFaceAttempt(rentalId);
      logger.info(
        `[APP-FACE]  rental=${rentalId} user=${req.user.userId} kiosk=${session.kioskId} ` +
          `verified=false confidence=${(result.confidence * 100).toFixed(1)}% ` +
          `exhausted=${exhausted} attemptsRemaining=${attemptsRemaining}`,
      );
      res.json({
        success: true,
        data: {
          verified: false,
          detected: result.detected,
          confidence: result.confidence,
          action: "none",
          mustRescan: exhausted,
          attemptsRemaining,
        },
        message: exhausted
          ? "We couldn't match your face after several tries — please scan the kiosk QR code again"
          : "We couldn't match your face — please try again",
      });
      return;
    }

    const io = req.app.get("io");
    if (!io) throw new ValidationError("Realtime channel unavailable");

    const { action, error: outcomeError } = await applyFaceVerificationOutcome({
      io,
      rentalId,
      kioskId: session.kioskId,
      confidence: result.confidence,
    });

    // Verified is single-use either way — a locker either opened or the
    // outcome failed for a reason a retry within this session won't fix
    // (missing locker record, no space at this kiosk).
    consumeKioskSession(rentalId);

    logger.info(
      `[APP-FACE]  rental=${rentalId} user=${req.user.userId} kiosk=${session.kioskId} ` +
        `detected=${result.detected} verified=true ` +
        `confidence=${(result.confidence * 100).toFixed(1)}% action=${action}` +
        (outcomeError ? ` error=${outcomeError}` : ""),
    );

    res.json({
      success: true,
      data: {
        verified: true,
        detected: result.detected,
        confidence: result.confidence,
        action,
      },
      message: outcomeError ?? "Identity confirmed",
    });
  } catch (error) {
    next(error);
  }
};
