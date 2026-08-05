import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../utils/errors";
import logger from "../utils/logger";
import kioskEventBus from "../utils/kioskEventBus";
import { decryptFaceEncoding } from "../utils/crypto";
import {
  signedMediaUrl,
  saveBuffer,
  verificationImagePath,
} from "../services/storageService";
import { Request } from "express";
import { v4 as uuidv4 } from "uuid";

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
 * POST /kiosk/claim
 * Initiates the claim sequence.  The Pi captures the renter's face; the
 * kiosk:face socket handler (index.ts) opens the door and advances to ACTIVE.
 */
export const claimItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const { rentalId } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true, renter: true, depositLocker: true },
    });

    if (!rental) throw new NotFoundError("Rental not found");
    if (rental.renterId !== req.user.userId)
      throw new ForbiddenError("Only the renter can claim the item");
    if (rental.status !== "DEPOSITED")
      throw new ValidationError("Item is not ready for claim");
    if (!rental.depositLocker)
      throw new ValidationError("No locker assigned to this rental");

    const { depositLocker: locker } = rental;

    // Command Pi: capture face → kiosk:face socket handler takes over.
    // Prefer the decrypted stored encoding (fast, no re-download/re-encode on
    // the ML side) over the reference URL, which stays as a fallback.
    const decodedEncoding = decryptFaceEncoding(rental.renter.faceEncoding);
    const io = req.app.get("io");
    if (io) {
      io.to(`kiosk:${locker.kioskId}`).emit("kiosk:command", {
        action: "capture_face",
        locker_id: parseInt(locker.lockerNumber, 10),
        rental_id: rentalId,
        user_id: req.user.userId,
        // signedMediaUrl() converts the stored path into a short-lived,
        // single-purpose URL the kiosk can fetch over plain HTTP — the
        // kiosk has no user JWT (only its Socket.io shared-secret), so the
        // authenticated /media/users/:id/face.jpg route isn't reachable to
        // it; a signed link is the correct tier for this consumer.
        reference_face_url: signedMediaUrl(rental.renter.profileImage) ?? "",
        ...(decodedEncoding
          ? { stored_encoding: JSON.stringify(decodedEncoding) }
          : {}),
      });
    }

    logger.info(
      `Claim face-check initiated: rental ${rentalId}, locker ${locker.lockerNumber}`,
    );

    res.json({
      success: true,
      message: "Face verification started. Please look at the camera.",
      data: {
        locker: { lockerNumber: locker.lockerNumber, kioskId: locker.kioskId },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /kiosk/return
 * Initiates the return sequence.  Face verification → image capture → ML.
 * The full verification is handled by the kiosk:face and kiosk:images
 * socket handlers in index.ts.
 */
export const returnItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");

    const { rentalId, lockerId } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true, renter: true },
    });

    if (!rental) throw new NotFoundError("Rental not found");
    if (rental.renterId !== req.user.userId)
      throw new ForbiddenError("Only the renter can return the item");
    if (rental.status !== "ACTIVE")
      throw new ValidationError("Rental is not active");

    const locker = lockerId
      ? await prisma.locker.findUnique({ where: { id: lockerId } })
      : await prisma.locker.findFirst({
          where: { status: "AVAILABLE", isOperational: true },
        });

    if (!locker || locker.status !== "AVAILABLE")
      throw new ValidationError("No available locker");

    // Reserve the return locker
    await prisma.locker.update({
      where: { id: locker.id },
      data: {
        status: "RESERVED",
        currentRentalId: rentalId,
        lastUsedAt: new Date(),
      },
    });

    // Command Pi: open door so renter can place item, then capture face + images
    const io = req.app.get("io");
    if (io) {
      io.to(`kiosk:${locker.kioskId}`).emit("kiosk:command", {
        action: "open_door",
        locker_id: parseInt(locker.lockerNumber, 10),
        door: "main_door",
        rental_id: rentalId,
      });

      // After door closes — request face capture first
      const decodedEncoding = decryptFaceEncoding(rental.renter.faceEncoding);
      setTimeout(() => {
        io.to(`kiosk:${locker.kioskId}`).emit("kiosk:command", {
          action: "capture_face",
          locker_id: parseInt(locker.lockerNumber, 10),
          rental_id: rentalId,
          user_id: req.user!.userId,
          // signedMediaUrl() converts the stored path into a short-lived,
        // single-purpose URL the kiosk can fetch over plain HTTP — the
        // kiosk has no user JWT (only its Socket.io shared-secret), so the
        // authenticated /media/users/:id/face.jpg route isn't reachable to
        // it; a signed link is the correct tier for this consumer.
        reference_face_url: signedMediaUrl(rental.renter.profileImage) ?? "",
          ...(decodedEncoding
            ? { stored_encoding: JSON.stringify(decodedEncoding) }
            : {}),
        });
      }, 20_000);
    }

    logger.info(
      `Return initiated: rental ${rentalId}, locker ${locker.lockerNumber}`,
    );

    res.json({
      success: true,
      message:
        "Locker opened. Place item inside — face verification will follow.",
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
    res.json({
      success: true,
      message: `Locker ${locker.lockerNumber} released`,
    });
  } catch (error) {
    next(error);
  }
};
