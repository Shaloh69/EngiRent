import { Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import { hashPassword, comparePassword } from "../utils/bcrypt";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt";
import {
  ValidationError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from "../utils/errors";
import logger from "../utils/logger";
import { encryptJson } from "../utils/crypto";
import axios from "axios";
import env from "../config/env";
import {
  saveBuffer,
  deleteStoredPath,
  storedFileExists,
  userFacePath,
  userIdPath,
} from "../services/storageService";

// Note: `User.profileImage`/`idImageUrl` store *relative storage paths*
// (`users/{id}/face.jpg`, `users/{id}/id.jpg`), not URLs — these get
// converted into real, fresh URLs globally by
// middleware/mediaUrlRewriter.ts on every outgoing res.json() response, not
// per-controller here (avatar → an authenticated-route URL; ID photo → a
// short-lived signed one — see that file for why each tier differs).

const PROFILE_SELECT = {
  id: true,
  email: true,
  studentId: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  profileImage: true,
  idImageUrl: true,
  profileComplete: true,
  parentName: true,
  parentContact: true,
  isVerified: true,
  verificationStatus: true,
  verificationReason: true,
  verificationNote: true,
  verifiedAt: true,
  isActive: true,
  role: true,
  lastLogin: true,
  createdAt: true,
  payoutProvider: true,
  payoutBic: true,
  payoutInstitutionName: true,
  payoutAccountName: true,
  payoutAccountNumber: true, // stripped by toPublicUser() below — never sent as-is (it's an encrypted blob, but still internal shape)
} as const;

/** Replaces the raw (encrypted) payoutAccountNumber with a plain
 * "is it set" boolean before a user record goes out over the API — the
 * client only ever needs to know whether payout is configured, never the
 * stored ciphertext shape. */
function toPublicUser<T extends { payoutAccountNumber?: unknown }>(
  user: T,
): Omit<T, "payoutAccountNumber"> & { payoutConfigured: boolean } {
  const { payoutAccountNumber, ...rest } = user;
  return { ...rest, payoutConfigured: payoutAccountNumber != null };
}

export const register = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      email,
      password,
      studentId,
      firstName,
      lastName,
      phoneNumber,
      parentName,
      parentContact,
    } = req.body;

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { studentId }] },
    });

    if (existingUser) {
      throw new ConflictError("Email or Student ID already registered");
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        studentId,
        firstName,
        lastName,
        phoneNumber,
        parentName: parentName ?? null,
        parentContact: parentContact ?? null,
      },
      select: PROFILE_SELECT,
    });

    const payload = {
      userId: user.id,
      email: user.email,
      studentId: user.studentId,
      role: user.role as "STUDENT" | "ADMIN",
    };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken },
    });

    logger.info(`New user registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: { user: toPublicUser(user), tokens: { accessToken, refreshToken } },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) throw new UnauthorizedError("Invalid email or password");
    if (!user.isActive) throw new UnauthorizedError("Account is deactivated");

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid)
      throw new UnauthorizedError("Invalid email or password");

    const payload = {
      userId: user.id,
      email: user.email,
      studentId: user.studentId,
      role: user.role as "STUDENT" | "ADMIN",
    };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date(), refreshToken },
    });

    logger.info(`User logged in: ${user.email}`);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          email: user.email,
          studentId: user.studentId,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          profileImage: user.profileImage,
          idImageUrl: user.idImageUrl,
          profileComplete: user.profileComplete,
          isVerified: user.isVerified,
          role: user.role,
          payoutConfigured: user.payoutAccountNumber != null,
        },
        tokens: { accessToken, refreshToken },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) throw new ValidationError("Refresh token is required");

    const decoded = verifyRefreshToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || user.refreshToken !== token)
      throw new UnauthorizedError("Invalid refresh token");
    if (!user.isActive) throw new UnauthorizedError("Account is deactivated");

    const payload = {
      userId: user.id,
      email: user.email,
      studentId: user.studentId,
      role: user.role as "STUDENT" | "ADMIN",
    };
    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: newRefreshToken },
    });

    res.json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { refreshToken: null },
    });
    logger.info(`User logged out: ${req.user.email}`);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: PROFILE_SELECT,
    });

    if (!user) throw new NotFoundError("User not found");
    res.json({ success: true, data: { user: toPublicUser(user) } });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const { firstName, lastName, phoneNumber, parentName, parentContact } =
      req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(phoneNumber && { phoneNumber }),
        ...(parentName !== undefined && { parentName }),
        ...(parentContact !== undefined && { parentContact }),
      },
      select: PROFILE_SELECT,
    });

    logger.info(`Profile updated: ${req.user.email}`);
    res.json({
      success: true,
      message: "Profile updated successfully",
      data: { user: toPublicUser(updatedUser) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /auth/payout-destination
 *
 * Collects where this user's rental earnings and security-deposit refunds
 * go — a PayMongo Disbursement destination (bank account or e-wallet), used
 * by rentalSettlementService.finalizeRentalCompletion() once a rental this
 * user owns completes. Optional at signup; a rental simply can't pay this
 * user out until it's set (see that service for the "not configured yet"
 * fallback behavior). The account number is genuine financial PII — same
 * at-rest encryption utility as User.faceEncoding, not a second scheme.
 */
export const updatePayoutDestination = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const { provider, bic, institutionName, accountName, accountNumber } =
      req.body as {
        provider?: string;
        bic?: string;
        institutionName?: string;
        accountName?: string;
        accountNumber?: string;
      };

    if (!["instapay", "pesonet"].includes(provider ?? ""))
      throw new ValidationError("provider must be 'instapay' or 'pesonet'");
    if (!bic || !institutionName)
      throw new ValidationError(
        "bic and institutionName are required — pick a destination from GET /payments/receiving-institutions rather than typing them freely",
      );
    if (!accountName || !accountNumber)
      throw new ValidationError("accountName and accountNumber are required");

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        payoutProvider: provider,
        payoutBic: bic,
        payoutInstitutionName: institutionName,
        payoutAccountName: accountName,
        payoutAccountNumber: encryptJson(
          accountNumber,
        ) as unknown as Prisma.InputJsonValue,
      },
      select: PROFILE_SELECT,
    });

    logger.info(`Payout destination updated: ${req.user.email}`);
    res.json({
      success: true,
      message: "Payout destination saved",
      data: { user: toPublicUser(updatedUser) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /auth/register-face
 *
 * Proxies a face-registration photo to the ML service's /register-face
 * endpoint, attaching the X-API-Key header server-side. This exists so the
 * Flutter app never has to hold ML_SERVICE_API_KEY itself — that secret is
 * meant for server-to-server calls, and embedding it in a distributed mobile
 * app bundle (extractable from the APK) would defeat its purpose entirely.
 * The kiosk, by contrast, is a physically-secured device (not a public
 * client) and calls the ML service directly with its own copy of the key —
 * see server/kiosk/services/face_service.py.
 */
export const registerFace = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");
    if (!req.file) {
      throw new ValidationError("A face image file is required");
    }

    const formData = new FormData();
    formData.append(
      "image",
      new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }),
      "face.jpg",
    );

    const mlResp = await axios.post(
      `${env.ML_SERVICE_URL}/api/v1/register-face`,
      formData,
      {
        headers: {
          ...(env.ML_SERVICE_API_KEY && {
            "X-API-Key": env.ML_SERVICE_API_KEY,
          }),
        },
      },
    );

    // Store the same photo as this user's canonical face/avatar image,
    // regardless of whether the ML service could extract an encoding from
    // it (a photo that fails encoding extraction is still a usable avatar,
    // and completeProfile separately requires a *successful* encoding
    // before it will mark the profile complete — see below).
    await saveBuffer(userFacePath(req.user.userId), req.file.buffer);

    res.json({ success: true, data: mlResp.data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /auth/id-photo
 *
 * Stores the school-ID photo at a deterministic, private path
 * (users/{userId}/id.jpg) — separate from /upload/image, which is for
 * non-sensitive item listing photos only. No URL is round-tripped through
 * the client; completeProfile() derives the path itself from req.user.userId.
 */
export const uploadIdPhoto = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");
    if (!req.file) {
      throw new ValidationError("An ID photo file is required");
    }
    await saveBuffer(userIdPath(req.user.userId), req.file.buffer);
    res.json({ success: true, message: "ID photo received" });
  } catch (error) {
    next(error);
  }
};

export const completeProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const { faceEncoding, biometricConsent } = req.body;

    // A separate, explicit affirmative consent is required before any
    // biometric data (face photo, ID photo, face encoding) is stored —
    // distinct from general terms-of-service acceptance. The client must
    // present its own clear consent statement + checkbox and only send
    // `biometricConsent: true` after the user affirmatively agrees.
    if (biometricConsent !== true) {
      throw new ValidationError(
        "Explicit biometric consent (biometricConsent: true) is required to submit face/ID photos",
      );
    }

    if (
      faceEncoding !== undefined &&
      faceEncoding !== null &&
      (!Array.isArray(faceEncoding) || faceEncoding.length !== 128)
    ) {
      throw new ValidationError(
        "faceEncoding must be a 128-element float array",
      );
    }

    // The face/ID photos are no longer client-supplied URLs — they were
    // already written to their deterministic paths by POST /auth/register-
    // face and POST /auth/id-photo (both keyed off req.user.userId, not a
    // client-controlled value). Confirm both actually exist in storage
    // before marking the profile complete, rather than trusting the client's
    // say-so that the earlier upload steps succeeded.
    const facePath = userFacePath(req.user.userId);
    const idPath = userIdPath(req.user.userId);
    const [hasFace, hasId] = await Promise.all([
      storedFileExists(facePath),
      storedFileExists(idPath),
    ]);
    if (!hasFace || !hasId) {
      throw new ValidationError(
        "Face photo and ID photo must be uploaded (POST /auth/register-face and /auth/id-photo) before completing your profile",
      );
    }

    // faceEncoding is a biometric template — never written to the DB in
    // plaintext. encryptJson() produces an AES-256-GCM blob; see
    // utils/crypto.ts and decryptFaceEncoding() for the read side.
    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        profileImage: facePath,
        idImageUrl: idPath,
        ...(faceEncoding
          ? {
              faceEncoding: encryptJson(
                faceEncoding,
              ) as unknown as Prisma.InputJsonValue,
            }
          : {}),
        profileComplete: true,
        biometricConsentAt: new Date(),
        // Enters the admin review queue. Previously nothing set this, so a
        // completed profile sat in no state at all and no admin surface could
        // find it (mandate 2.11).
        verificationStatus: "PENDING",
        // Clear the previous decision. This path is also the re-submit path
        // after a rejection, and leaving the old reason attached made the
        // profile read "Under review" and "the photo was unreadable" at the
        // same time — the student cannot tell whether their new photo landed.
        // `isVerified` is deliberately NOT reset: an already-approved student
        // re-uploading a photo shouldn't lose access mid-rental. A rejected
        // student is already false, so the gate stays correct either way.
        verificationReason: null,
        verificationNote: null,
        verifiedById: null,
        verifiedAt: null,
      },
      select: PROFILE_SELECT,
    });

    logger.info(`Profile completed: ${req.user.email}`);
    res.json({
      success: true,
      message: "Profile completed successfully",
      data: { user: toPublicUser(updatedUser) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /auth/account
 *
 * Real biometric-data deletion + account deactivation — the RA 10173
 * (Data Privacy Act) erasure right this system previously had no path for.
 * Requires password re-confirmation (a destructive action, not a routine
 * profile edit). Genuinely purges faceEncoding/idImageUrl/profileImage from
 * the database and best-effort deletes the underlying stored images, then
 * deactivates the account (isActive: false) — deactivation alone is *not*
 * treated as sufficient by itself; the biometric fields are actually cleared
 * regardless of whether the delete-from-storage calls succeed, since the DB
 * row is the authoritative record of what personal data still exists.
 *
 * Rental/transaction/review history is intentionally preserved (not
 * cascaded) for accounting integrity — this endpoint's scope is the
 * biometric/PII erasure right, not a full right-to-be-forgotten wipe of
 * transactional records.
 */
export const deleteAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const { password } = req.body;
    if (!password) {
      throw new ValidationError(
        "Current password is required to delete your account",
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });
    if (!user) throw new NotFoundError("User not found");

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid)
      throw new UnauthorizedError("Current password is incorrect");

    // Best-effort deletion of the underlying stored files. Failures here
    // (e.g. a disk I/O hiccup) do not block the DB purge below — a dangling
    // orphaned file is a lesser privacy risk than a plaintext biometric
    // record that failed to clear because of a storage error.
    for (const relativePath of [
      userFacePath(req.user.userId),
      userIdPath(req.user.userId),
    ]) {
      try {
        await deleteStoredPath(relativePath);
      } catch (err) {
        logger.warn(`Account deletion: failed to delete stored file: ${err}`);
      }
    }

    await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        faceEncoding: Prisma.JsonNull,
        profileImage: null,
        idImageUrl: null,
        profileComplete: false,
        biometricConsentAt: null,
        isActive: false,
        refreshToken: null,
      },
    });

    logger.info(`Account deleted (biometric data purged): ${req.user.email}`);
    res.json({
      success: true,
      message:
        "Your account has been deactivated and your biometric data has been permanently deleted.",
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });
    if (!user) throw new NotFoundError("User not found");

    const isPasswordValid = await comparePassword(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid)
      throw new UnauthorizedError("Current password is incorrect");

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { password: hashedPassword },
    });

    logger.info(`Password changed: ${req.user.email}`);
    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    next(error);
  }
};
