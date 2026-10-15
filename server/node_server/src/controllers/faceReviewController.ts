/**
 * Admin review of a re-enrolled face that did not match the account's old
 * template (face liveness, ruling 2026-10-15; see faceEnrolController.ts).
 *
 *   GET  /admin/face-reviews             every face waiting, oldest first
 *   POST /admin/face-reviews/:id         { decision: APPROVE | REJECT, note? }
 *
 * The reviewer sees the current face and the new one side by side (signed,
 * short-lived links) and decides whether they are the same student. Approve
 * makes the new face the account's template (version 2); reject discards it.
 * Either way the student is told, and the decision is audited.
 */

import { Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import logger from "../utils/logger";
import { NotFoundError, ValidationError } from "../utils/errors";
import {
  deleteStoredPath,
  readStoredFile,
  saveBuffer,
  signedMediaUrl,
  storedFileExists,
  userFacePath,
  userIdPath,
  userPendingFacePath,
} from "../services/storageService";
import { recordAudit } from "../services/auditLogService";
import { LIVENESS_ENROLMENT_VERSION } from "./faceEnrolController";

export const listFaceReviews = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      where: { pendingFaceAt: { not: null } },
      orderBy: { pendingFaceAt: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        studentId: true,
        profileImage: true,
        idImageUrl: true,
        faceEnrolmentVersion: true,
        pendingFaceAt: true,
        pendingFaceReason: true,
        pendingFaceDistance: true,
      },
    });
    res.json({
      success: true,
      data: {
        reviews: users.map((u) => ({
          userId: u.id,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          studentId: u.studentId,
          submittedAt: u.pendingFaceAt,
          reason: u.pendingFaceReason,
          distance: u.pendingFaceDistance,
          currentFaceUrl: u.profileImage ? signedMediaUrl(userFacePath(u.id)) : null,
          newFaceUrl: signedMediaUrl(userPendingFacePath(u.id)),
          idPhotoUrl: u.idImageUrl ? signedMediaUrl(userIdPath(u.id)) : null,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const decideFaceReview = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const { decision, note } = req.body as { decision?: string; note?: string };
    if (decision !== "APPROVE" && decision !== "REJECT") {
      throw new ValidationError("decision must be APPROVE or REJECT");
    }
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, pendingFaceAt: true, pendingFaceEncoding: true },
    });
    if (!user) throw new NotFoundError("User not found");
    if (!user.pendingFaceAt || !user.pendingFaceEncoding) {
      throw new ValidationError("This student has no new face waiting for review");
    }

    const approved = decision === "APPROVE";
    const clearPending = {
      pendingFaceEncoding: Prisma.JsonNull,
      pendingFaceAt: null,
      pendingFaceReason: null,
      pendingFaceDistance: null,
    };

    if (approved) {
      const pendingPath = userPendingFacePath(id);
      if (!(await storedFileExists(pendingPath))) {
        throw new ValidationError("The new face photo is missing from storage; ask the student to update their face again");
      }
      await saveBuffer(userFacePath(id), await readStoredFile(pendingPath));
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.user.update({
          where: { id },
          data: approved
            ? {
                faceEncoding: user.pendingFaceEncoding as Prisma.InputJsonValue,
                faceEnrolmentVersion: LIVENESS_ENROLMENT_VERSION,
                profileImage: userFacePath(id),
                ...clearPending,
              }
            : clearPending,
        });
        await tx.notification.create({
          data: {
            userId: id,
            title: approved ? "New face approved" : "New face not approved",
            message: approved
              ? "An admin approved your new face. You can use the kiosk again."
              : `An admin could not approve your new face.${note?.trim() ? ` ${note.trim()}` : ""} Please update your face again from the home screen.`,
            type: approved ? "VERIFICATION_SUCCESS" : "VERIFICATION_FAILED",
            relatedEntityId: id,
            relatedEntityType: "user",
          },
        });
      },
      { timeout: 15_000 },
    );
    await deleteStoredPath(userPendingFacePath(id)).catch(() => undefined);

    await recordAudit(req, {
      action: approved ? "faceReview.approve" : "faceReview.reject",
      targetType: "user",
      targetId: id,
      reason: null,
      metadata: { note: note?.trim() || null },
    });
    logger.info(`Admin ${req.user?.userId} ${approved ? "approved" : "rejected"} the new face of user ${id}`);

    req.app.get("io")?.to(`user:${id}`).emit("face:review_decided", { userId: id, approved });
    res.json({ success: true, data: { userId: id, approved } });
  } catch (error) {
    next(error);
  }
};
