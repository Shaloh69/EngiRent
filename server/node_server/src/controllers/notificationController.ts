import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import { ForbiddenError, ValidationError } from "../utils/errors";

// Checklist Stage 9 — notification preferences. Filtered at *read* time
// rather than at each of the ~25 `prisma.notification.create` call sites
// scattered across index.ts/adminController.ts/paymentController.ts/
// rentalController.ts/messageController.ts/rentalSettlementService.ts —
// every notification still gets created (so nothing about badge counts or
// the notification's own existence changes), muted types just never show
// up in what the student reads. Simpler and much lower-risk than threading
// a preference check through every creation site, for the same practical
// effect. SYSTEM_ANNOUNCEMENT and the verification-outcome types are
// deliberately not offered as mutable in the app's UI (see the Flutter
// notification-preferences screen), but the mechanism itself doesn't
// hardcode that — it respects whatever the stored list actually contains.
const MUTABLE_NOTIFICATION_TYPES = [
  "BOOKING_CONFIRMED",
  "ITEM_READY_FOR_CLAIM",
  "RENTAL_STARTED",
  "RETURN_REMINDER",
  "RETURN_OVERDUE",
  "PAYMENT_RECEIVED",
  "FEEDBACK_UPDATE",
] as const;

export const getNotificationPreferences = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { notificationMutedTypes: true },
    });
    res.json({
      success: true,
      data: {
        mutedTypes: (user?.notificationMutedTypes as string[] | null) ?? [],
        mutableTypes: MUTABLE_NOTIFICATION_TYPES,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateNotificationPreferences = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    const { mutedTypes } = req.body as { mutedTypes?: unknown };
    if (!Array.isArray(mutedTypes) || !mutedTypes.every((t) => typeof t === "string")) {
      throw new ValidationError("mutedTypes must be an array of strings");
    }
    // Only the types the UI actually offers can be muted — an unrecognised
    // or non-mutable value silently sneaking in here would mute something
    // the student has no way to see or undo from the app.
    const invalid = mutedTypes.filter(
      (t) => !MUTABLE_NOTIFICATION_TYPES.includes(t as never),
    );
    if (invalid.length > 0) {
      throw new ValidationError(`Cannot mute: ${invalid.join(", ")}`);
    }

    await prisma.user.update({
      where: { id: req.user.userId },
      data: { notificationMutedTypes: mutedTypes },
    });
    res.json({ success: true, data: { mutedTypes } });
  } catch (error) {
    next(error);
  }
};

export const getNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const { isRead, page = "1", limit = "20" } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const me = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { notificationMutedTypes: true },
    });
    const mutedTypes = (me?.notificationMutedTypes as string[] | null) ?? [];

    const where: any = {
      userId: req.user.userId,
      ...(mutedTypes.length > 0 ? { type: { notIn: mutedTypes } } : {}),
    };

    if (isRead !== undefined) {
      where.isRead = isRead === "true";
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          userId: req.user.userId,
          isRead: false,
          ...(mutedTypes.length > 0 ? { type: { notIn: mutedTypes } } : {}),
        } as any,
      }),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const id = req.params.id as string;

    await prisma.notification.update({
      where: {
        id,
        userId: req.user.userId,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    next(error);
  }
};

export const markAllAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    await prisma.notification.updateMany({
      where: {
        userId: req.user.userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    next(error);
  }
};

export const deleteNotification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError("Authentication required");
    }

    const id = req.params.id as string;

    await prisma.notification.delete({
      where: {
        id,
        userId: req.user.userId,
      },
    });

    res.json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    next(error);
  }
};
