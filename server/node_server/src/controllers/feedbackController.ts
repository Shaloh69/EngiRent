import { Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { FeedbackCategory, Prisma } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import { UnauthorizedError, ValidationError } from "../utils/errors";
import logger from "../utils/logger";
import { saveBuffer, feedbackScreenshotPath, signedMediaUrl } from "../services/storageService";
import { getRecentKioskEvents } from "../utils/kioskEventLog";

/**
 * Checklist Stage 3 — before this there was no feedback, support or
 * bug-report endpoint on the server at all. A student who hit a problem had
 * no route to the people running the system; the admins running a
 * deployment had no signal except rentals silently failing (mandate §2.9.3).
 */

export const FEEDBACK_CATEGORIES: Record<string, string> = {
  BUG: "Something broke",
  SUGGESTION: "Suggestion",
  KIOSK_PROBLEM: "Kiosk / locker problem",
  PAYMENT_PROBLEM: "Payment problem",
  OTHER: "Other",
};

/**
 * POST /feedback
 *
 * multipart/form-data: category, body, appVersion, device?, screen?,
 * rentalId?, kioskId?, and an optional `file` (screenshot).
 */
export const submitFeedback = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");

    const {
      category,
      body,
      appVersion,
      device,
      screen,
      rentalId,
      kioskId,
    } = req.body as Record<string, string | undefined>;

    if (!category || !FEEDBACK_CATEGORIES[category]) {
      throw new ValidationError(
        `category must be one of: ${Object.keys(FEEDBACK_CATEGORIES).join(", ")}`,
      );
    }
    if (!body || !body.trim()) {
      throw new ValidationError("A description is required");
    }
    if (body.trim().length > 4000) {
      throw new ValidationError("Description is too long (max 4000 characters)");
    }

    // A rental ID is only trustworthy context if it's actually this
    // student's rental — otherwise a report could reference (and a triaging
    // admin could be misled by) someone else's transaction.
    if (rentalId) {
      const rental = await prisma.rental.findUnique({
        where: { id: rentalId },
        select: { renterId: true, ownerId: true },
      });
      if (!rental || (rental.renterId !== req.user.userId && rental.ownerId !== req.user.userId)) {
        throw new ValidationError("rentalId does not belong to you");
      }
    }

    const id = uuidv4();

    // Kiosk-problem reports must include what actually happened, not just a
    // kiosk ID and a timestamp — "the locker didn't open" is unanswerable
    // otherwise. Snapshotting is best-effort: a report with no matching
    // events (e.g. the kiosk was never actually reached) is still filed.
    const kioskEventSnapshot =
      category === "KIOSK_PROBLEM" && kioskId
        ? getRecentKioskEvents(kioskId)
        : undefined;

    let screenshotPath: string | null = null;
    if (req.file) {
      const ext = req.file.mimetype === "image/png" ? "png" : "jpg";
      screenshotPath = feedbackScreenshotPath(id, `screenshot.${ext}`);
      await saveBuffer(screenshotPath, req.file.buffer);
    }

    const feedback = await prisma.feedback.create({
      data: {
        id,
        userId: req.user.userId,
        category: category as FeedbackCategory,
        body: body.trim(),
        screenshotPath,
        appVersion: appVersion?.trim() || "unknown",
        device: device?.trim() || null,
        screen: screen?.trim() || null,
        rentalId: rentalId || null,
        kioskId: kioskId || null,
        kioskEventSnapshot: kioskEventSnapshot
          ? (kioskEventSnapshot as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      select: { id: true, category: true, createdAt: true },
    });

    logger.info(
      `Feedback submitted: ${feedback.id} (${feedback.category}) by ${req.user.userId}`,
    );

    res.status(201).json({ success: true, data: { feedback } });
  } catch (error) {
    next(error);
  }
};

/** GET /feedback/mine — a student's own reports, so filing one isn't a
 * one-way write into the dark; they can see it was received. */
export const getMyFeedback = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError("Not authenticated");
    const items = await prisma.feedback.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        category: true,
        body: true,
        status: true,
        adminNote: true,
        createdAt: true,
        resolvedAt: true,
      },
    });
    res.json({ success: true, data: { feedback: items } });
  } catch (error) {
    next(error);
  }
};

/** Shared with adminController's feedback endpoints — kept here since it's
 * specific to this domain rather than admin-general. */
export function signFeedbackScreenshot(path: string | null): string | null {
  return path ? signedMediaUrl(path) : null;
}
