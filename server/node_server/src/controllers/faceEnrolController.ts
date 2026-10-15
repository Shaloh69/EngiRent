/**
 * Face enrolment through the liveness flow (2026-10-15,
 * docs/redesign/SPEC-FACE-LIVENESS.md F2b/F4).
 *
 *   GET  /auth/face/challenge  a random step order + nonce, 5 minutes
 *   POST /auth/face/enrol      the four frames + that nonce
 *
 * Two cases, decided from the account, never from the request:
 *
 *   SETUP (profile not complete yet): a live, bare-headed face becomes the
 *   template (version 2). It still goes through the existing ID review when
 *   the profile is completed.
 *
 *   RE-ENROL ("Update your face", ruling 2026-10-15): the new live face must
 *   match the OLD template (dlib distance <= 0.5) to replace it at once. If it
 *   does not match, or there is no old template, the student re-enters their
 *   password and the new face waits for an admin; until approved it does not
 *   pass a kiosk face step (faceVerificationService.faceEnrolmentGate). Without
 *   this, anyone holding a student's password could bind their own face to
 *   that account and open lockers as them.
 *
 * The template is computed by the ML service from the frames and stored here;
 * it never travels through the phone (the old two-step register-face →
 * profile/complete flow handed it to the client and took it back).
 */

import { Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import logger from "../utils/logger";
import { NotFoundError, UnauthorizedError, ValidationError } from "../utils/errors";
import { comparePassword } from "../utils/bcrypt";
import { decryptFaceEncoding, encryptJson } from "../utils/crypto";
import { deleteStoredPath, saveBuffer, userFacePath, userPendingFacePath } from "../services/storageService";
import { notifyAdmins } from "../services/adminRoom";
import {
  checkEnrolChallenge,
  checkLivenessWithMl,
  consumeEnrolChallenge,
  issueEnrolChallenge,
  livenessMessage,
  publicChallenge,
  readFaceFrames,
  type LivenessResult,
} from "../services/faceLivenessService";

/** The version a liveness enrolment writes; the kiosk accepts only this. */
export const LIVENESS_ENROLMENT_VERSION = 2;

export const getFaceChallenge = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");
    const c = issueEnrolChallenge(req.user.userId);
    res.json({ success: true, data: { challenge: publicChallenge(c) } });
  } catch (error) {
    next(error);
  }
};

export const enrolFace = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");
    const userId = req.user.userId;
    const { nonce, mirrored, password, biometricConsent } = req.body as Record<string, string | undefined>;

    const frames = readFaceFrames(req);

    if (!checkEnrolChallenge(userId, nonce)) {
      res.status(409).json({
        success: false,
        code: "CHALLENGE_EXPIRED",
        error: "These steps have expired. Please follow the new steps.",
        data: { challenge: publicChallenge(issueEnrolChallenge(userId)) },
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, faceEncoding: true, profileComplete: true },
    });
    if (!user) throw new NotFoundError("User not found");

    const setup = !user.profileComplete;
    if (setup && biometricConsent !== "true") {
      throw new ValidationError(
        "Explicit biometric consent (biometricConsent: true) is required before your face is saved",
      );
    }
    const oldTemplate = setup ? null : decryptFaceEncoding(user.faceEncoding ?? null);

    let r: LivenessResult;
    try {
      r = await checkLivenessWithMl(frames, {
        storedEncoding: oldTemplate,
        returnEncoding: true,
        mirrored: mirrored === "true",
      });
    } catch (err) {
      // Fail closed; the challenge stands so the same frames can be resent.
      logger.error(`[FACE-ENROL] liveness unavailable for ${userId}:`, err);
      throw new ValidationError("Verification service is unavailable right now — please try again in a moment");
    }

    if (!r.live || !r.encoding) {
      consumeEnrolChallenge(userId);
      logger.info(`[FACE-ENROL] ${userId}: not live (${r.reason} on ${r.step}) metrics=${JSON.stringify(r.metrics)}`);
      res.json({
        success: true,
        data: {
          enrolled: false,
          reason: r.reason,
          challenge: publicChallenge(issueEnrolChallenge(userId)),
        },
        message: livenessMessage(r.reason),
      });
      return;
    }

    const centre = frames.centre.buffer;
    const template = encryptJson(r.encoding) as unknown as Prisma.InputJsonValue;
    const clearPending = {
      pendingFaceEncoding: Prisma.JsonNull,
      pendingFaceAt: null,
      pendingFaceReason: null,
      pendingFaceDistance: null,
    };

    // SETUP, or a re-enrolment that matched the old template: the new face
    // replaces the old one now.
    if (setup || (oldTemplate && r.matched === true)) {
      await saveBuffer(userFacePath(userId), centre);
      await prisma.user.update({
        where: { id: userId },
        data: {
          faceEncoding: template,
          faceEnrolmentVersion: LIVENESS_ENROLMENT_VERSION,
          profileImage: userFacePath(userId),
          ...(setup && { biometricConsentAt: new Date() }),
          ...clearPending,
        },
      });
      await deleteStoredPath(userPendingFacePath(userId)).catch(() => undefined);
      consumeEnrolChallenge(userId);
      logger.info(`[FACE-ENROL] ${userId}: enrolled (${setup ? "setup" : `re-enrol, distance ${r.distance}`})`);
      res.json({
        success: true,
        data: { enrolled: true, mode: setup ? "setup" : "update" },
        message: "Your face is saved.",
      });
      return;
    }

    // RE-ENROL without a match (or no old template): password, then review.
    const reason = oldTemplate ? "NO_MATCH" : "NO_TEMPLATE";
    if (!password) {
      // The challenge is NOT consumed: the app resends the same frames and
      // nonce with the password.
      res.json({
        success: true,
        data: { enrolled: false, needsPassword: true, reason },
        message:
          oldTemplate
            ? "This face doesn't match the one on your account. Enter your password to send it to an admin for review."
            : "There is no face on your account to compare with. Enter your password to send this one to an admin for review.",
      });
      return;
    }
    if (!(await comparePassword(password, user.password))) {
      // A wrong password ends this attempt: the steps must be done again, so
      // the password cannot be guessed against one capture.
      consumeEnrolChallenge(userId);
      throw Object.assign(new ValidationError("That password is not correct. Please do the steps again."), {
        code: "WRONG_PASSWORD",
      });
    }

    await saveBuffer(userPendingFacePath(userId), centre);
    await prisma.user.update({
      where: { id: userId },
      data: {
        pendingFaceEncoding: template,
        pendingFaceAt: new Date(),
        pendingFaceReason: reason,
        pendingFaceDistance: r.distance,
      },
    });
    consumeEnrolChallenge(userId);
    notifyAdmins(req.app.get("io"), "admin:face_review", { userId, reason });
    logger.info(`[FACE-ENROL] ${userId}: sent for admin review (${reason}, distance ${r.distance})`);
    res.json({
      success: true,
      data: { enrolled: false, pendingReview: true, reason },
      message: "Sent to an admin for review. You can use the kiosk again once it is approved.",
    });
  } catch (error) {
    next(error);
  }
};
