import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import { NotFoundError, ValidationError } from "../utils/errors";
import logger from "../utils/logger";
import { hashPassword } from "../utils/bcrypt";
import kioskEventBus from "../utils/kioskEventBus";

// ─── Dashboard stats ───────────────────────────────────────────────────────

export const getStats = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const [
      totalUsers,
      totalItems,
      activeRentals,
      pendingVerifications,
      completedRentals,
    ] = await Promise.all([
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.item.count({ where: { isActive: true } }),
      prisma.rental.count({
        where: { status: { in: ["ACTIVE", "AWAITING_DEPOSIT", "DEPOSITED"] } },
      }),
      prisma.verification.count({ where: { status: "MANUAL_REVIEW" } }),
      prisma.rental.count({ where: { status: "COMPLETED" } }),
    ]);

    const revenueResult = await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { status: "COMPLETED", type: "RENTAL_PAYMENT" },
    });

    const totalRevenue = revenueResult._sum.amount ?? 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalItems,
        activeRentals,
        pendingVerifications,
        completedRentals,
        totalRevenue,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── User management ──────────────────────────────────────────────────────

export const listUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { search, page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { email: { contains: search as string } },
        { firstName: { contains: search as string } },
        { lastName: { contains: search as string } },
        { studentId: { contains: search as string } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        select: {
          id: true,
          email: true,
          studentId: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          isVerified: true,
          isActive: true,
          role: true,
          createdAt: true,
          lastLogin: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { isActive, isVerified, role } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("User not found");

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(isVerified !== undefined && { isVerified }),
        ...(role && { role }),
      },
      select: {
        id: true,
        email: true,
        studentId: true,
        firstName: true,
        lastName: true,
        isVerified: true,
        isActive: true,
        role: true,
      },
    });

    logger.info(
      `Admin updated user ${id}: ${JSON.stringify({ isActive, isVerified, role })}`,
    );
    res.json({
      success: true,
      message: "User updated",
      data: { user: updated },
    });
  } catch (error) {
    next(error);
  }
};

export const createAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, password, studentId, firstName, lastName, phoneNumber } =
      req.body;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { studentId }] },
    });
    if (existing)
      throw new ValidationError("Email or Student ID already in use");

    const hashed = await hashPassword(password);
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashed,
        studentId,
        firstName,
        lastName,
        phoneNumber,
        role: "ADMIN",
      },
      select: {
        id: true,
        email: true,
        studentId: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    logger.info(`Admin account created: ${email} by ${req.user?.email}`);
    res.status(201).json({
      success: true,
      message: "Admin account created",
      data: { user: admin },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Rental management ────────────────────────────────────────────────────

export const listAllRentals = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { status, page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [rentals, total] = await Promise.all([
      prisma.rental.findMany({
        where,
        skip,
        take,
        include: {
          item: { select: { id: true, title: true, category: true } },
          renter: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.rental.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        rentals,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const forceCompleteRental = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { notes } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { item: true },
    });
    if (!rental) throw new NotFoundError("Rental not found");

    if (!["VERIFICATION", "DISPUTED"].includes(rental.status)) {
      throw new ValidationError(
        "Rental can only be force-completed from VERIFICATION or DISPUTED status",
      );
    }

    await prisma.$transaction([
      prisma.rental.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          actualReturnDate: new Date(),
        },
      }),
      prisma.item.update({
        where: { id: rental.itemId },
        data: { isAvailable: true, totalRentals: { increment: 1 } },
      }),
      prisma.notification.create({
        data: {
          userId: rental.renterId,
          title: "Rental Completed",
          message: `Your rental of ${rental.item.title} has been marked as completed by an admin.${notes ? ` Note: ${notes}` : ""}`,
          type: "VERIFICATION_SUCCESS",
          relatedEntityId: id,
          relatedEntityType: "rental",
        },
      }),
      prisma.notification.create({
        data: {
          userId: rental.ownerId,
          title: "Rental Completed",
          message: `Rental of ${rental.item.title} has been completed. Payment will be released.${notes ? ` Note: ${notes}` : ""}`,
          type: "VERIFICATION_SUCCESS",
          relatedEntityId: id,
          relatedEntityType: "rental",
        },
      }),
    ]);

    logger.info(`Admin force-completed rental ${id} by ${req.user?.email}`);
    res.json({ success: true, message: "Rental marked as completed" });
  } catch (error) {
    next(error);
  }
};

// ─── Verification management ──────────────────────────────────────────────

export const listVerifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { status, decision, page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (decision) where.decision = decision;

    const [verifications, total] = await Promise.all([
      prisma.verification.findMany({
        where,
        skip,
        take,
        include: {
          rental: {
            select: {
              id: true,
              status: true,
              item: { select: { id: true, title: true } },
              renter: { select: { id: true, firstName: true, lastName: true } },
              owner: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          depositRental: {
            select: {
              id: true,
              status: true,
              item: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.verification.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        verifications,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const reviewVerification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status, reviewNotes } = req.body as {
      status: "APPROVED" | "REJECTED";
      reviewNotes?: string;
    };

    if (!["APPROVED", "REJECTED"].includes(status)) {
      throw new ValidationError("Status must be APPROVED or REJECTED");
    }

    const verification = await prisma.verification.findUnique({
      where: { id },
      include: {
        rental: { include: { item: true } },
        depositRental: { include: { item: true } },
      },
    });
    if (!verification) throw new NotFoundError("Verification not found");

    await prisma.verification.update({
      where: { id },
      data: {
        status,
        reviewedBy: req.user?.userId,
        reviewNotes: reviewNotes ?? null,
      },
    });

    // When a return verification is manually approved → complete rental
    const returnRental = verification.rental;
    if (
      returnRental &&
      status === "APPROVED" &&
      returnRental.status === "VERIFICATION"
    ) {
      await prisma.$transaction([
        prisma.rental.update({
          where: { id: returnRental.id },
          data: {
            status: "COMPLETED",
            verificationStatus: "APPROVED",
            completedAt: new Date(),
          },
        }),
        prisma.item.update({
          where: { id: returnRental.itemId },
          data: { isAvailable: true, totalRentals: { increment: 1 } },
        }),
        prisma.notification.create({
          data: {
            userId: returnRental.renterId,
            title: "Rental Completed",
            message: `Return of ${returnRental.item.title} has been approved. Security deposit will be refunded.`,
            type: "VERIFICATION_SUCCESS",
            relatedEntityId: returnRental.id,
            relatedEntityType: "rental",
          },
        }),
        prisma.notification.create({
          data: {
            userId: returnRental.ownerId,
            title: "Item Return Approved",
            message: `Return of ${returnRental.item.title} has been verified. Payment will be released.`,
            type: "VERIFICATION_SUCCESS",
            relatedEntityId: returnRental.id,
            relatedEntityType: "rental",
          },
        }),
      ]);
    }

    // Manual rejection on return → open dispute
    if (
      returnRental &&
      status === "REJECTED" &&
      returnRental.status === "VERIFICATION"
    ) {
      await prisma.rental.update({
        where: { id: returnRental.id },
        data: { status: "DISPUTED", verificationStatus: "REJECTED" },
      });
    }

    logger.info(
      `Admin reviewed verification ${id} → ${status} by ${req.user?.email}`,
    );
    res.json({
      success: true,
      message: `Verification ${status.toLowerCase()}`,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Kiosk config ─────────────────────────────────────────────────────────

const DEFAULT_LOCKER_CONFIG = {
  main_door_open_seconds: 15,
  trapdoor_unlock_seconds: 2,
  bottom_door_open_seconds: 15,
  actuator_push_seconds: 5,
  actuator_pull_seconds: 5,
  actuator_speed_percent: 100,
};

const DEFAULT_CONFIG = {
  lockers: {
    "1": { ...DEFAULT_LOCKER_CONFIG },
    "2": { ...DEFAULT_LOCKER_CONFIG },
    "3": { ...DEFAULT_LOCKER_CONFIG },
    "4": { ...DEFAULT_LOCKER_CONFIG },
  },
  face_recognition: {
    confidence_threshold: 0.6,
    capture_attempts: 3,
    capture_timeout_seconds: 30,
  },
};

export const getKioskConfig = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const kioskId = req.params.kioskId as string;

    const record = await prisma.kioskConfig.findUnique({ where: { kioskId } });
    const config = record?.config ?? DEFAULT_CONFIG;

    res.json({ success: true, data: { kioskId, config } });
  } catch (error) {
    next(error);
  }
};

export const updateKioskConfig = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const kioskId = req.params.kioskId as string;
    const { config } = req.body;

    if (!config || typeof config !== "object") {
      throw new ValidationError("config object is required");
    }

    const record = await prisma.kioskConfig.upsert({
      where: { kioskId },
      update: { config, updatedBy: req.user?.userId },
      create: { kioskId, config, updatedBy: req.user?.userId },
    });

    // Push config to connected Pi via Socket.io (io is attached to req.app)
    const io = req.app.get("io");
    if (io) {
      io.to(`kiosk:${kioskId}`).emit("kiosk:config", config);
      logger.info(`Pushed kiosk:config to kiosk:${kioskId}`);
    }

    logger.info(
      `Admin updated kiosk config for ${kioskId} by ${req.user?.email}`,
    );
    res.json({
      success: true,
      message: "Kiosk config updated",
      data: { config: record.config },
    });
  } catch (error) {
    next(error);
  }
};

export const sendKioskCommand = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const kioskId = req.params.kioskId as string;
    const {
      action,
      lockerId,
      door,
      durationOverride,
      pushSeconds,
      pullSeconds,
      speedPercent,
      numFrames,
    } = req.body;

    const validActions = [
      "open_door",
      "drop_item",
      "capture_image",
      "capture_face",
      "lock_all",
      "actuator_extend",
      "actuator_retract",
    ];

    if (!action || !validActions.includes(action)) {
      throw new ValidationError(
        `action must be one of: ${validActions.join(", ")}`,
      );
    }

    const io = req.app.get("io");
    if (!io) {
      res
        .status(503)
        .json({ success: false, message: "Socket.io not available" });
      return;
    }

    const commandId = Math.random().toString(16).slice(2, 10).toUpperCase();

    const payload: Record<string, unknown> = { action, command_id: commandId };
    if (lockerId !== undefined) payload.locker_id = lockerId;
    if (door) payload.door = door;
    if (durationOverride !== undefined)
      payload.duration_override = durationOverride;
    if (pushSeconds !== undefined) payload.push_seconds = pushSeconds;
    if (pullSeconds !== undefined) payload.pull_seconds = pullSeconds;
    if (speedPercent !== undefined) payload.speed = speedPercent;
    if (numFrames !== undefined) payload.num_frames = numFrames;

    io.to(`kiosk:${kioskId}`).emit("kiosk:command", payload);

    logger.info(
      `\n┌─────────────────────────────────────────────\n` +
      `│  📤 [CMD-SENT]  Admin sent kiosk command\n` +
      `│  Kiosk      : ${kioskId}\n` +
      `│  Command ID : ${commandId}\n` +
      `│  Action     : ${action}\n` +
      `│  By         : ${req.user?.email}\n` +
      `│  Payload    : ${JSON.stringify(payload)}\n` +
      `└─────────────────────────────────────────────`
    );
    res.json({
      success: true,
      message: `Command "${action}" sent to kiosk ${kioskId}`,
      data: { commandId },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Kiosk SSE stream ─────────────────────────────────────────────────────

export const kioskEventStream = (req: AuthRequest, res: Response): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering on Render
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client already disconnected
    }
  };

  send("connected", { ts: Date.now() });

  const onStatus = (d: unknown) => send("kiosk_status", d);
  const onOnline = (d: unknown) => send("kiosk_online", d);
  const onAck = (d: unknown) => send("kiosk_ack", d);
  const onError = (d: unknown) => send("kiosk_error", d);

  kioskEventBus.on("kiosk_status", onStatus);
  kioskEventBus.on("kiosk_online", onOnline);
  kioskEventBus.on("kiosk_ack", onAck);
  kioskEventBus.on("kiosk_error", onError);

  // Heartbeat keeps the connection alive through proxies/load balancers
  const heartbeat = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    kioskEventBus.off("kiosk_status", onStatus);
    kioskEventBus.off("kiosk_online", onOnline);
    kioskEventBus.off("kiosk_ack", onAck);
    kioskEventBus.off("kiosk_error", onError);
    logger.info(`SSE client disconnected: ${req.user?.email ?? "unknown"}`);
  });
};

export const listKiosks = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Distinct kiosk IDs from lockers + any stored configs
    const [lockerKiosks, configs] = await Promise.all([
      prisma.locker.groupBy({ by: ["kioskId"] }),
      prisma.kioskConfig.findMany({
        select: { kioskId: true, updatedAt: true },
      }),
    ]);

    const kioskIds = new Set([
      ...lockerKiosks.map((l) => l.kioskId),
      ...configs.map((c) => c.kioskId),
    ]);

    res.json({ success: true, data: { kiosks: Array.from(kioskIds) } });
  } catch (error) {
    next(error);
  }
};
