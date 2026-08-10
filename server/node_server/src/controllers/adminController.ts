import { Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import { NotFoundError, ValidationError } from "../utils/errors";
import logger from "../utils/logger";
import { hashPassword } from "../utils/bcrypt";
import kioskEventBus from "../utils/kioskEventBus";
import {
  signedMediaUrl,
  userIdPath,
  userFacePath,
} from "../services/storageService";
import axios from "axios";
import fs from "fs";
import env from "../config/env";
import { finalizeRentalCompletion } from "../services/rentalSettlementService";
import { recomputeItemAvailability } from "../services/itemAvailabilityService";
import { FEEDBACK_CATEGORIES } from "./feedbackController";
import { recordAudit } from "../services/auditLogService";
import { sendCsv } from "../utils/csv";

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

    // Real per-category rental counts for the admin dashboard's "popular
    // categories" chart — Prisma's groupBy can't traverse the Item relation
    // directly, and this dataset is small enough that aggregating in JS is
    // simpler and clearer than a raw SQL join.
    const rentalsWithCategory = await prisma.rental.findMany({
      select: { item: { select: { category: true } } },
    });
    const categoryCounts = new Map<string, number>();
    for (const r of rentalsWithCategory) {
      categoryCounts.set(
        r.item.category,
        (categoryCounts.get(r.item.category) ?? 0) + 1,
      );
    }
    const rentalsByCategory = Array.from(categoryCounts.entries()).map(
      ([category, count]) => ({ category, count }),
    );

    res.json({
      success: true,
      data: {
        totalUsers,
        totalItems,
        activeRentals,
        pendingVerifications,
        completedRentals,
        totalRevenue,
        rentalsByCategory,
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
    const { search, page = "1", limit = "20", format } = req.query;
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

    const userSelect = {
      id: true,
      email: true,
      studentId: true,
      firstName: true,
      lastName: true,
      phoneNumber: true,
      isVerified: true,
      // The list view previously collapsed this to `isVerified ? APPROVED :
      // PENDING`, which showed "Pending" for a student who never submitted
      // an ID at all (verificationStatus stays UNSUBMITTED until they do) —
      // indistinguishable from someone genuinely sitting in the real
      // /id-verifications queue. Sending the real 4-state field lets the
      // client stop guessing.
      verificationStatus: true,
      isActive: true,
      role: true,
      createdAt: true,
      lastLogin: true,
    } as const;

    // Checklist Stage 9 — CSV export ignores pagination (the whole point is
    // getting everything out of the screen at once), capped at 5000 rows
    // so a runaway filter can't turn this into an unbounded query.
    if (format === "csv") {
      const rows = await prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      sendCsv(
        res,
        "engirent-users",
        ["Email", "Student ID", "First Name", "Last Name", "Phone", "Verified", "Verification Status", "Active", "Role", "Joined", "Last Login"],
        rows,
        (u) => [u.email, u.studentId, u.firstName, u.lastName, u.phoneNumber, u.isVerified, u.verificationStatus, u.isActive, u.role, u.createdAt.toISOString(), u.lastLogin?.toISOString() ?? ""],
      );
      return;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        select: userSelect,
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
    await recordAudit(req, {
      action: "user.update",
      targetType: "user",
      targetId: id,
      metadata: { isActive, isVerified, role },
    });
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
    const { email, password, studentId, firstName, lastName, phoneNumber, role } =
      req.body;

    // Checklist Stage 9 — role granularity. Defaults to ADMIN (unchanged
    // behavior for existing callers); REVIEWER is the only other value
    // this endpoint is allowed to create — it must never be used to create
    // a plain STUDENT account by accident.
    const grantedRole = role === "REVIEWER" ? "REVIEWER" : "ADMIN";

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
        role: grantedRole,
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

    logger.info(`${grantedRole} account created: ${email} by ${req.user?.email}`);
    await recordAudit(req, {
      action: "user.createStaff",
      targetType: "user",
      targetId: admin.id,
      metadata: { email, role: grantedRole },
    });
    res.status(201).json({
      success: true,
      message: `${grantedRole === "ADMIN" ? "Admin" : "Reviewer"} account created`,
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
    const { status, page = "1", limit = "20", format } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const rentalInclude = {
      item: { select: { id: true, title: true, category: true } },
      renter: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      owner: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    } as const;

    if (format === "csv") {
      const rows = await prisma.rental.findMany({
        where,
        include: rentalInclude,
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      sendCsv(
        res,
        "engirent-rentals",
        ["Item", "Category", "Renter", "Owner", "Status", "Start", "End", "Total Price", "Deposit", "Created"],
        rows,
        (r) => [r.item.title, r.item.category, `${r.renter.firstName} ${r.renter.lastName}`, `${r.owner.firstName} ${r.owner.lastName}`, r.status, r.startDate.toISOString(), r.endDate.toISOString(), r.totalPrice, r.securityDeposit, r.createdAt.toISOString()],
      );
      return;
    }

    const [rentals, total] = await Promise.all([
      prisma.rental.findMany({
        where,
        skip,
        take,
        include: rentalInclude,
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

    // Checklist Stage 6 — the transaction above sets isAvailable: true
    // unconditionally; this corrects it if a different, non-overlapping
    // rental on the same item already covers today (only possible now that
    // an item can have more than one booking over time). Deliberately
    // outside the transaction — see itemAvailabilityService's doc comment.
    await recomputeItemAvailability(rental.itemId);

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
      // Checklist Stage 6 — see forceCompleteRental's identical comment.
      await recomputeItemAvailability(returnRental.itemId);
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

// ─── Transaction management ───────────────────────────────────────────────

export const listTransactions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const type = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const page = (req.query.page as string | undefined) ?? "1";
    const limit = (req.query.limit as string | undefined) ?? "20";
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where: Prisma.TransactionWhereInput = {};
    if (type) where.type = type as Prisma.TransactionWhereInput["type"];
    if (status) where.status = status as Prisma.TransactionWhereInput["status"];

    const transactionInclude = {
      rental: {
        select: {
          id: true,
          item: { select: { id: true, title: true } },
        },
      },
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    } as const;

    if (req.query.format === "csv") {
      const rows = await prisma.transaction.findMany({
        where,
        include: transactionInclude,
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      sendCsv(
        res,
        "engirent-transactions",
        ["User", "Type", "Item", "Amount", "Status", "Method", "Created"],
        rows,
        (t) => [`${t.user.firstName} ${t.user.lastName}`, t.type, t.rental?.item.title ?? "", t.amount, t.status, t.paymentMethod ?? "", t.createdAt.toISOString()],
      );
      return;
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take,
        include: transactionInclude,
        orderBy: { createdAt: "desc" },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          total,
          page: parseInt(page),
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const adminRefund = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const transactionId = req.params.transactionId as string;
    const { reason } = req.body as { reason?: string };

    type TxWithRelations = Prisma.TransactionGetPayload<{
      include: {
        rental: { include: { item: true } };
        user: { select: { id: true; firstName: true; email: true } };
      };
    }>;
    const transaction = (await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        rental: { include: { item: true } },
        user: { select: { id: true, firstName: true, email: true } },
      },
    })) as TxWithRelations | null;
    if (!transaction) throw new NotFoundError("Transaction not found");
    if (transaction.status !== "COMPLETED")
      throw new ValidationError("Only completed transactions can be refunded");

    const itemTitle = transaction.rental.item.title;

    await prisma.$transaction([
      prisma.transaction.update({
        where: { id: transactionId },
        data: { status: "REFUNDED" },
      }),
      prisma.transaction.create({
        data: {
          rentalId: transaction.rentalId,
          userId: transaction.userId,
          type: "DEPOSIT_REFUND",
          amount: transaction.amount,
          status: "COMPLETED",
          paidAt: new Date(),
          paymentMethod: "Admin Manual Refund",
        },
      }),
      prisma.notification.create({
        data: {
          userId: transaction.userId,
          title: "Refund Processed",
          message: `Admin issued a refund of ₱${transaction.amount.toFixed(2)} for ${itemTitle}.${reason ? ` Reason: ${reason}` : ""}`,
          type: "PAYMENT_RECEIVED",
          relatedEntityId: transaction.rentalId,
          relatedEntityType: "transaction",
        },
      }),
    ]);

    logger.info(
      `Admin refunded transaction ${transactionId} — ₱${transaction.amount} by ${req.user?.email}`,
    );
    res.json({ success: true, message: "Refund issued" });
  } catch (error) {
    next(error);
  }
};

export const settleDispute = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { outcome, damageFee, notes } = req.body as {
      outcome: "owner_wins" | "renter_wins";
      damageFee?: number;
      notes?: string;
    };

    if (!["owner_wins", "renter_wins"].includes(outcome)) {
      throw new ValidationError("outcome must be owner_wins or renter_wins");
    }

    type RentalWithItem = Prisma.RentalGetPayload<{ include: { item: true } }>;
    const rental = (await prisma.rental.findUnique({
      where: { id },
      include: { item: true },
    })) as RentalWithItem | null;
    if (!rental) throw new NotFoundError("Rental not found");
    if (rental.status !== "DISPUTED")
      throw new ValidationError("Rental is not in DISPUTED status");

    // Checklist Stage 8 — "the deposit is the cover, capped at X" has to be
    // a real, enforced rule for that to be an honest thing to tell a
    // student at checkout, not just narration. finalizeRentalCompletion
    // already floors the refund at 0 (so nothing beyond the deposit is ever
    // actually collected), but without this check an admin could enter a
    // damageFee larger than the deposit and the recorded DAMAGE_FEE
    // transaction would silently overstate what was actually charged.
    if (
      outcome === "owner_wins" &&
      damageFee !== undefined &&
      damageFee !== null &&
      damageFee > rental.securityDeposit
    ) {
      throw new ValidationError(
        `Damage fee (₱${damageFee}) cannot exceed the held security deposit ` +
          `(₱${rental.securityDeposit}) — the deposit is the renter's full liability cap.`,
      );
    }

    const itemTitle = rental.item.title;
    const disputeNote = notes ? ` Note: ${notes}` : "";

    await prisma.$transaction(async (tx) => {
      await tx.rental.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await tx.item.update({
        where: { id: rental.itemId },
        data: { isAvailable: true, totalRentals: { increment: 1 } },
      });
      await tx.notification.create({
        data: {
          userId: rental.renterId,
          title: "Dispute Resolved",
          message: `Dispute for ${itemTitle} resolved by admin.${disputeNote}`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: id,
          relatedEntityType: "rental",
        },
      });
      await tx.notification.create({
        data: {
          userId: rental.ownerId,
          title: "Dispute Resolved",
          message: `Dispute for ${itemTitle} resolved by admin.${disputeNote}`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: id,
          relatedEntityType: "rental",
        },
      });
      // If owner wins + damage fee specified, bill the renter
      if (outcome === "owner_wins" && damageFee && damageFee > 0) {
        await tx.transaction.create({
          data: {
            rentalId: id,
            userId: rental.renterId,
            type: "DAMAGE_FEE",
            amount: damageFee,
            status: "COMPLETED",
            paidAt: new Date(),
            paymentMethod: "Admin Assessment",
          },
        });
      }
    });

    // Checklist Stage 6 — see forceCompleteRental's identical comment.
    await recomputeItemAvailability(rental.itemId);

    // Same real money movement as the normal AI-verified completion path
    // (deposit refund net of damage/late fees + owner payout) — runs after
    // the $transaction above commits so the DAMAGE_FEE row it just wrote is
    // visible when finalizeRentalCompletion sums deductions.
    await finalizeRentalCompletion(id);

    logger.info(
      `Admin settled dispute ${id} → ${outcome} by ${req.user?.email}${damageFee ? ` damageFee=₱${damageFee}` : ""}`,
    );
    await recordAudit(req, {
      action: "dispute.settle",
      targetType: "rental",
      targetId: id,
      reason: notes,
      metadata: { outcome, damageFee: damageFee ?? null },
    });
    res.json({ success: true, message: "Dispute settled" });
  } catch (error) {
    next(error);
  }
};

// ─── Kiosk config ─────────────────────────────────────────────────────────

// No actuator_speed_percent — actuators are relay-driven on/off (no PWM
// speed-control circuit exists on the current hardware), so a "speed"
// setting here would be silently ignored by the Pi's actuator controller.
const DEFAULT_LOCKER_CONFIG = {
  main_door_open_seconds: 15,
  bottom_door_open_seconds: 15,
  actuator_extend_seconds: 5,
  actuator_retract_seconds: 5,
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
      locker_id,
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
      // Hardware self-test — pulses every solenoid/actuator briefly and
      // opens every camera, reporting pass/fail per component. Lets an admin
      // verify kiosk hardware remotely instead of needing physical/SSH
      // access to the Pi for every check (see docs/planning/03-revamp-master.md
      // §3.5's Components Check). Result comes back via kiosk:self_test_result
      // (index.ts), relayed through this same SSE stream below.
      "self_test",
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
    if (locker_id !== undefined) payload.locker_id = locker_id;
    if (door) payload.door = door;
    if (durationOverride !== undefined)
      payload.duration_override = durationOverride;
    if (pushSeconds !== undefined) payload.extend_seconds = pushSeconds;
    if (pullSeconds !== undefined) payload.retract_seconds = pullSeconds;
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
        `└─────────────────────────────────────────────`,
    );

    // "lock_all" is this kiosk's emergency stop today — the kiosk's own UI
    // labels it "Emergency lock engaged" (socket_client.py). This is a
    // *software* command dependent on the Pi process and network being
    // alive — exactly the scenario a real E-stop most needs to survive.
    // The actual fix (a normally-closed physical button wired in series with
    // the relay/solenoid power rail, cutting power regardless of software
    // state) requires hands-on hardware rework this session can't do — see
    // memory.md's Phase 2 entry. This block is the software-side half the
    // master plan asks for regardless: surface every trigger loudly rather
    // than let it pass as a routine command.
    if (action === "lock_all") {
      logger.warn(
        `[EMERGENCY STOP] lock_all triggered on kiosk ${kioskId} by ${req.user?.email} — command ${commandId}`,
      );
      kioskEventBus.emit("kiosk_emergency", {
        kiosk_id: kioskId,
        command_id: commandId,
        triggered_by: req.user?.email,
        ts: Date.now(),
      });
      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      await prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          title: "Emergency Stop Triggered",
          message: `${req.user?.email} triggered an emergency lock-all on kiosk ${kioskId}.`,
          type: "SYSTEM_ANNOUNCEMENT",
          relatedEntityId: kioskId,
          relatedEntityType: "kiosk",
        })),
      });
    }

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
  const onOffline = (d: unknown) => send("kiosk_offline", d);
  const onAck = (d: unknown) => send("kiosk_ack", d);
  const onError = (d: unknown) => send("kiosk_error", d);
  const onLog = (d: unknown) => send("kiosk_log", d);
  const onSnapshot = (d: unknown) => send("kiosk_admin_snapshot", d);
  // Hardware self-test results — extends this existing telemetry shape
  // rather than a separate channel; see the "self_test" action above.
  const onSelfTest = (d: unknown) => send("kiosk_self_test", d);
  // Emergency stop (lock_all) — see sendKioskCommand's emergency-stop block.
  const onEmergency = (d: unknown) => send("kiosk_emergency", d);

  kioskEventBus.on("kiosk_status", onStatus);
  kioskEventBus.on("kiosk_online", onOnline);
  kioskEventBus.on("kiosk_offline", onOffline);
  kioskEventBus.on("kiosk_ack", onAck);
  kioskEventBus.on("kiosk_error", onError);
  kioskEventBus.on("kiosk_log", onLog);
  kioskEventBus.on("kiosk_admin_snapshot", onSnapshot);
  kioskEventBus.on("kiosk_self_test", onSelfTest);
  kioskEventBus.on("kiosk_emergency", onEmergency);

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
    kioskEventBus.off("kiosk_offline", onOffline);
    kioskEventBus.off("kiosk_ack", onAck);
    kioskEventBus.off("kiosk_error", onError);
    kioskEventBus.off("kiosk_log", onLog);
    kioskEventBus.off("kiosk_admin_snapshot", onSnapshot);
    kioskEventBus.off("kiosk_self_test", onSelfTest);
    kioskEventBus.off("kiosk_emergency", onEmergency);
    logger.info(`SSE client disconnected: ${req.user?.email ?? "unknown"}`);
  });
};

// ─── System Components Check (PC-side software health) ────────────────────
// Backs the admin Health Check page's software panel — a live version of
// the same checks Start.bat runs at PC startup, so an admin can re-check
// without needing shell access to the machine. Per-Pi hardware status is a
// separate concern, driven by the "self_test" kiosk command + SSE stream
// above, not this endpoint.

interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { name: "MySQL Database", ok: true, detail: "Reachable" };
  } catch (err) {
    return {
      name: "MySQL Database",
      ok: false,
      detail: `Unreachable: ${(err as Error).message}`,
    };
  }
}

function checkStorageDir(): HealthCheck {
  try {
    fs.accessSync(env.STORAGE_DIR, fs.constants.R_OK | fs.constants.W_OK);
    return {
      name: "Local Storage",
      ok: true,
      detail: `${env.STORAGE_DIR} is readable/writable`,
    };
  } catch {
    // Not yet created is fine — saveBuffer() creates it on first upload.
    return {
      name: "Local Storage",
      ok: true,
      detail: `${env.STORAGE_DIR} does not exist yet — created automatically on first upload`,
    };
  }
}

async function checkMlService(): Promise<HealthCheck> {
  try {
    const resp = await axios.get(`${env.ML_SERVICE_URL}/api/v1/health`, {
      timeout: 5000,
    });
    return {
      name: "ML Verification Service",
      ok: resp.status === 200,
      detail: `Responded ${resp.status} at ${env.ML_SERVICE_URL}`,
    };
  } catch (err) {
    return {
      name: "ML Verification Service",
      ok: false,
      detail: `Unreachable at ${env.ML_SERVICE_URL}: ${(err as Error).message}`,
    };
  }
}

function checkPaymongo(): HealthCheck {
  const key = env.PAYMONGO_SECRET_KEY;
  const configured = Boolean(key) && !key!.includes("your-") && !key!.includes("change-me");
  return {
    name: "PayMongo",
    ok: configured,
    detail: configured
      ? "PAYMONGO_SECRET_KEY is configured"
      : "PAYMONGO_SECRET_KEY is unset or still a placeholder",
  };
}

async function checkAdminConsole(): Promise<HealthCheck> {
  try {
    const resp = await axios.get(env.CLIENT_ADMIN_URL, { timeout: 5000 });
    return {
      name: "Admin Console",
      ok: resp.status < 500,
      detail: `Responded ${resp.status} at ${env.CLIENT_ADMIN_URL}`,
    };
  } catch (err) {
    return {
      name: "Admin Console",
      ok: false,
      detail: `Unreachable at ${env.CLIENT_ADMIN_URL}: ${(err as Error).message}`,
    };
  }
}

export const getSystemHealth = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const checks = await Promise.all([
      checkDatabase(),
      Promise.resolve(checkStorageDir()),
      checkMlService(),
      Promise.resolve(checkPaymongo()),
      checkAdminConsole(),
    ]);
    // The Node API responding at all is this check itself succeeding.
    checks.unshift({ name: "Node API", ok: true, detail: "Responding" });

    res.json({
      success: true,
      data: {
        overall: checks.every((c) => c.ok) ? "ok" : "degraded",
        checks,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
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

    res.json({
      success: true,
      data: { kiosks: Array.from(kioskIds).map((id) => ({ id })) },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Reports ────────────────────────────────────────────────────────────────

export const getReports = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const format = (req.query.format as string | undefined) ?? "json";
    const fromDate = req.query.from
      ? new Date(req.query.from as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = req.query.to ? new Date(req.query.to as string) : new Date();

    const dateRange: Prisma.DateTimeFilter = { gte: fromDate, lte: toDate };

    const [
      rentalsByStatus,
      revenueByType,
      topItems,
      verificationStats,
      userGrowth,
      categoryBreakdown,
    ] = await Promise.all([
      prisma.rental.groupBy({
        by: ["status"],
        _count: { id: true },
        where: { createdAt: dateRange },
      }),
      prisma.transaction.groupBy({
        by: ["type"],
        _sum: { amount: true },
        _count: { id: true },
        where: { status: "COMPLETED", createdAt: dateRange },
      }),
      prisma.item.findMany({
        where: { isActive: true },
        orderBy: { totalRentals: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          category: true,
          totalRentals: true,
          averageRating: true,
          pricePerDay: true,
        },
      }),
      prisma.verification.groupBy({
        by: ["decision"],
        _count: { id: true },
        where: { createdAt: dateRange },
      }),
      prisma.user.groupBy({
        by: ["createdAt"],
        _count: { id: true },
        where: { role: "STUDENT", createdAt: dateRange },
        orderBy: { createdAt: "asc" },
      }),
      prisma.item.groupBy({
        by: ["category"],
        _count: { id: true },
        where: { isActive: true },
      }),
    ]);

    const totalRevenue = revenueByType.reduce(
      (sum, r) => sum + (r._sum.amount ?? 0),
      0,
    );

    const report = {
      period: { from: fromDate, to: toDate },
      summary: {
        totalRevenue,
        totalRentals: rentalsByStatus.reduce((s, r) => s + r._count.id, 0),
        totalVerifications: verificationStats.reduce(
          (s, v) => s + v._count.id,
          0,
        ),
      },
      rentalsByStatus: Object.fromEntries(
        rentalsByStatus.map((r) => [r.status, r._count.id]),
      ),
      revenueByType: Object.fromEntries(
        revenueByType.map((r) => [r.type, r._sum.amount ?? 0]),
      ),
      verificationsByDecision: Object.fromEntries(
        verificationStats.map((v) => [v.decision, v._count.id]),
      ),
      categoryBreakdown: Object.fromEntries(
        categoryBreakdown.map((c) => [c.category, c._count.id]),
      ),
      topItems,
      userGrowth: userGrowth.map((u) => ({
        date: u.createdAt,
        count: u._count.id,
      })),
    };

    if (format === "csv") {
      const rows: string[] = [
        "Report Type,Value",
        `Total Revenue,${totalRevenue}`,
        `Total Rentals,${report.summary.totalRentals}`,
        `Total Verifications,${report.summary.totalVerifications}`,
        "",
        "Rentals by Status",
        "Status,Count",
        ...rentalsByStatus.map((r) => `${r.status},${r._count.id}`),
        "",
        "Revenue by Type",
        "Type,Amount",
        ...revenueByType.map((r) => `${r.type},${r._sum.amount ?? 0}`),
        "",
        "Top Items",
        "Title,Category,Total Rentals,Avg Rating",
        ...topItems.map(
          (i) =>
            `"${i.title}",${i.category},${i.totalRentals},${i.averageRating}`,
        ),
      ];

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="engirent-report-${fromDate.toISOString().slice(0, 10)}.csv"`,
      );
      res.send(rows.join("\n"));
      return;
    }

    if (format === "pdf") {
      // Return structured JSON for the Flutter/Admin client to render as PDF
      // (actual PDF generation happens client-side via pdf/printing packages)
      res.setHeader("X-Report-Format", "pdf-data");
      res.json({ success: true, data: report, format: "pdf" });
      return;
    }

    res.json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
};

// ── Student ID verification ──────────────────────────────────────────────
//
// The account-verification review path. Before this existed, `isVerified` was
// only ever set by an admin manually flipping the flag through
// PATCH /admin/users/:id — no queue, no evidence, no record of who decided or
// why, and no notification to the student (mandate §2.11).
//
// Note the distinction from `listVerifications` above, which returns
// `prisma.verification` rows: those are the AI condition checks comparing a
// rental's deposit and return photos. Two different things that the old
// naming ran together.

/** Rejection reasons. A closed set so the student gets a consistent, useful
 *  message and so decisions can be counted; the reviewer's free-text note is
 *  carried separately in `verificationNote`. */
export const ID_REJECT_REASONS: Record<string, string> = {
  UNREADABLE: "The photo was too blurry or dark to read.",
  NOT_A_STUDENT_ID: "That doesn't appear to be a UCLM student ID.",
  NAME_MISMATCH: "The name on the ID doesn't match the account.",
  EXPIRED: "The ID has expired.",
  SUSPECTED_FORGERY: "The ID could not be accepted. Please visit the registrar.",
};

/**
 * GET /admin/id-verifications
 * Queue of students awaiting (or having received) an ID decision.
 */
export const listIdVerifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const status = String(req.query.status ?? "PENDING");
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Prisma.UserWhereInput = {
      role: "STUDENT",
      ...(status !== "ALL" ? { verificationStatus: status } : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          studentId: true,
          phoneNumber: true,
          profileImage: true,
          idImageUrl: true,
          isVerified: true,
          verificationStatus: true,
          verificationReason: true,
          verificationNote: true,
          verifiedById: true,
          verifiedAt: true,
          createdAt: true,
        },
        // Oldest first: a queue that shows newest first quietly starves the
        // people who have been waiting longest.
        orderBy: { createdAt: "asc" },
      }),
      prisma.user.count({ where }),
    ]);

    // Signed, short-lived URLs rather than raw paths. The ID photo has no
    // route that serves it directly, by design — see storageService's comment
    // on userIdPath(). This is the only way an admin can see the evidence.
    const rows = users.map((u) => ({
      ...u,
      idImageUrl: undefined,
      idPhotoUrl: u.idImageUrl ? signedMediaUrl(userIdPath(u.id)) : null,
      facePhotoUrl: u.profileImage ? signedMediaUrl(userFacePath(u.id)) : null,
    }));

    res.json({
      success: true,
      data: {
        verifications: rows,
        rejectReasons: ID_REJECT_REASONS,
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

/**
 * POST /admin/id-verifications/:id
 * Record a decision on a student's ID, notify them, and set the gate.
 */
export const decideIdVerification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.id);
    const { decision, reason, note } = req.body as {
      decision: "APPROVE" | "REJECT";
      reason?: string;
      note?: string;
    };

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("User not found");

    if (decision === "REJECT" && (!reason || !ID_REJECT_REASONS[reason])) {
      throw new ValidationError(
        "A valid rejection reason is required so the student is told what to fix",
      );
    }

    const approved = decision === "APPROVE";

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          isVerified: approved,
          verificationStatus: approved ? "APPROVED" : "REJECTED",
          verificationReason: approved ? null : reason,
          verificationNote: note?.trim() || null,
          verifiedById: req.user?.userId ?? null,
          verifiedAt: new Date(),
        },
        select: {
          id: true,
          isVerified: true,
          verificationStatus: true,
          verificationReason: true,
          verificationNote: true,
          verifiedAt: true,
        },
      });

      // Telling the student is the point. A decision they never learn about
      // leaves them exactly where the old flag-flip did.
      await tx.notification.create({
        data: {
          userId: id,
          title: approved ? "Account verified" : "ID could not be verified",
          message: approved
            ? "Your student ID was approved. You can now rent and list equipment."
            : `${ID_REJECT_REASONS[reason as string]}${note?.trim() ? ` ${note.trim()}` : ""} You can submit a new photo from your profile.`,
          type: approved ? "VERIFICATION_SUCCESS" : "VERIFICATION_FAILED",
          relatedEntityId: id,
          relatedEntityType: "user",
        },
      });

      return u;
    });

    logger.info(
      `Admin ${req.user?.userId} ${approved ? "approved" : "rejected"} ID for user ${id}${reason ? ` (${reason})` : ""}`,
    );
    await recordAudit(req, {
      action: approved ? "idVerification.approve" : "idVerification.reject",
      targetType: "user",
      targetId: id,
      reason: approved ? null : reason,
      metadata: { note: note?.trim() || null },
    });

    res.json({ success: true, data: { user: updated } });
  } catch (error) {
    next(error);
  }
};

/**
 * Feedback triage — checklist Stage 3.3. Without this the submission
 * endpoint is a write-only hole: students could file reports, but nothing
 * on the admin side could read them.
 */

/**
 * GET /admin/feedback
 * Filter by status/category; oldest-first for the same reason the ID
 * verification queue is oldest-first — newest-first quietly starves whoever
 * has been waiting longest.
 */
export const listFeedback = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const status = req.query.status ? String(req.query.status) : "NEW";
    const category = req.query.category ? String(req.query.category) : undefined;
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Prisma.FeedbackWhereInput = {
      ...(status !== "ALL" ? { status: status as never } : {}),
      ...(category ? { category: category as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          category: true,
          body: true,
          screenshotPath: true,
          appVersion: true,
          device: true,
          screen: true,
          rentalId: true,
          kioskId: true,
          itemId: true,
          kioskEventSnapshot: true,
          status: true,
          adminNote: true,
          resolvedById: true,
          resolvedAt: true,
          createdAt: true,
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, studentId: true },
          },
        },
      }),
      prisma.feedback.count({ where }),
    ]);

    const rows = items.map((f) => ({
      ...f,
      screenshotPath: undefined,
      screenshotUrl: f.screenshotPath ? signedMediaUrl(f.screenshotPath) : null,
    }));

    res.json({
      success: true,
      data: {
        feedback: rows,
        categories: FEEDBACK_CATEGORIES,
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

/**
 * PATCH /admin/feedback/:id
 * Moves a report through NEW → ACKNOWLEDGED → RESOLVED (or directly to
 * either). Resolving notifies the reporter — otherwise the loop this stage
 * exists to close only closes on the admin's side.
 */
export const updateFeedbackStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.id);
    const { status, note, fixedInVersion } = req.body as {
      status: string;
      note?: string;
      // Set when this BUG report is what prompted a new app release — the
      // Update Required screen credits the reporter by name for whichever
      // version this matches. Optional: most resolutions aren't tied to a
      // shippable fix (a "how do I..." question, a duplicate, etc).
      fixedInVersion?: string;
    };

    if (!["ACKNOWLEDGED", "RESOLVED"].includes(status)) {
      throw new ValidationError("status must be ACKNOWLEDGED or RESOLVED");
    }

    const existing = await prisma.feedback.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Feedback report not found");

    const updated = await prisma.$transaction(async (tx) => {
      const f = await tx.feedback.update({
        where: { id },
        data: {
          status: status as never,
          adminNote: note?.trim() || existing.adminNote,
          ...(fixedInVersion?.trim() ? { fixedInVersion: fixedInVersion.trim() } : {}),
          ...(status === "RESOLVED"
            ? { resolvedById: req.user?.userId ?? null, resolvedAt: new Date() }
            : {}),
        },
      });

      if (status === "RESOLVED") {
        await tx.notification.create({
          data: {
            userId: existing.userId,
            title: "Your feedback was resolved",
            message: note?.trim()
              ? note.trim()
              : "An admin marked your report as resolved. Thanks for flagging it.",
            type: "FEEDBACK_UPDATE",
            relatedEntityId: id,
            relatedEntityType: "feedback",
          },
        });
      }

      return f;
    });

    logger.info(`Admin ${req.user?.userId} moved feedback ${id} to ${status}`);
    await recordAudit(req, {
      action: "feedback.updateStatus",
      targetType: "feedback",
      targetId: id,
      metadata: { status },
    });

    res.json({ success: true, data: { feedback: updated } });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin item detail, ratings and moderation — checklist Stage 3.6.
 *
 * The Admin Console had an items *list* and nothing else, reading the public
 * /items endpoint — no admin item or review endpoints existed at all. An
 * admin investigating a complaint about a listing could not see its
 * reviews, its rental history, or its owner's record in one place.
 */

const MODERATION_ACTIONS = ["UNLIST", "RELIST", "FLAG", "UNFLAG", "RESTORE"] as const;
type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/**
 * GET /admin/items/:id
 * Full record: owner, every photo, rental history with outcomes, and the
 * review aggregate (average + star distribution) the detail page's ratings
 * panel needs.
 */
export const getItemDetail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.id);

    const item = await prisma.item.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            studentId: true,
            profileImage: true,
            isVerified: true,
          },
        },
        rentals: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
            actualReturnDate: true,
            totalPrice: true,
            securityDeposit: true,
            createdAt: true,
            renter: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });

    if (!item) throw new NotFoundError("Item not found");

    // Star distribution — the same shape the phone app's _RatingSummary
    // renders (average + tappable per-star bars), so both surfaces read the
    // same data the same way.
    const [ratingRows, lifetimeEarnings] = await Promise.all([
      prisma.review.groupBy({
        by: ["rating"],
        where: { itemId: id, reviewType: "ITEM", isDeleted: false },
        _count: { rating: true },
      }),
      prisma.rental.aggregate({
        where: { itemId: id, status: "COMPLETED" },
        _sum: { totalPrice: true },
      }),
    ]);

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let reviewCount = 0;
    for (const row of ratingRows) {
      distribution[row.rating] = row._count.rating;
      reviewCount += row._count.rating;
    }

    const { rentals, ...itemFields } = item;

    res.json({
      success: true,
      data: {
        item: itemFields,
        rentals,
        ratings: {
          average: item.averageRating,
          count: reviewCount,
          distribution,
        },
        lifetimeEarnings: lifetimeEarnings._sum.totalPrice ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /admin/items/:id/reviews
 * Every review, unlike the public endpoint — includes soft-deleted rows
 * (flagged as such) so an admin can see what was removed and why, not just
 * what survived.
 */
export const getItemReviewsAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.id);
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { itemId: id, reviewType: "ITEM" },
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          author: {
            select: { id: true, firstName: true, lastName: true, profileImage: true },
          },
        },
      }),
      prisma.review.count({ where: { itemId: id, reviewType: "ITEM" } }),
    ]);

    res.json({
      success: true,
      data: {
        reviews,
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

/**
 * PATCH /admin/items/:id
 * Moderation actions: unlist / relist / flag / unflag / restore. Distinct
 * from the owner-facing PUT /items/:id (itemController.updateItem) — this is
 * an admin acting on someone else's listing, with its own reason-tracking
 * and its own audit trail (moderatedById/moderatedAt on the item record
 * itself — there is no separate structured audit-log table yet; see mandate
 * §9's admin-gaps list).
 */
export const moderateItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.id);
    const { action, reason } = req.body as { action: ModerationAction; reason?: string };

    if (!MODERATION_ACTIONS.includes(action)) {
      throw new ValidationError(`action must be one of: ${MODERATION_ACTIONS.join(", ")}`);
    }
    // A new restriction needs a stated reason — an owner reading "your item
    // was flagged" with nothing else attached has no way to respond to it.
    // Reversals (RELIST/UNFLAG/RESTORE) don't carry the same bar.
    if ((action === "UNLIST" || action === "FLAG") && !reason?.trim()) {
      throw new ValidationError(`A reason is required to ${action.toLowerCase()} an item`);
    }

    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) throw new NotFoundError("Item not found");

    const data: Prisma.ItemUpdateInput = {
      moderatedById: req.user?.userId ?? null,
      moderatedAt: new Date(),
    };
    switch (action) {
      case "UNLIST":
        data.isListed = false;
        break;
      case "RELIST":
        data.isListed = true;
        break;
      case "FLAG":
        data.isFlagged = true;
        data.flagReason = reason?.trim();
        break;
      case "UNFLAG":
        data.isFlagged = false;
        data.flagReason = null;
        break;
      case "RESTORE":
        data.isActive = true;
        break;
    }

    const updated = await prisma.item.update({ where: { id }, data });

    logger.info(
      `Admin ${req.user?.userId} ${action} item ${id}${reason ? ` (${reason})` : ""}`,
    );
    await recordAudit(req, {
      action: `item.${action.toLowerCase()}`,
      targetType: "item",
      targetId: id,
      reason: reason?.trim() || null,
    });

    res.json({ success: true, data: { item: updated } });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /admin/reviews/:id
 * Soft-delete an abusive review. Recomputes the item's cached averageRating
 * the same way createReview does — otherwise a removed 1-star review would
 * still be dragging the average down for anyone browsing.
 */
export const deleteReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.id);
    const { reason } = req.body as { reason?: string };
    if (!reason?.trim()) {
      throw new ValidationError("A reason is required to remove a review");
    }

    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundError("Review not found");
    if (review.isDeleted) throw new ValidationError("This review was already removed");

    await prisma.review.update({
      where: { id },
      data: {
        isDeleted: true,
        deleteReason: reason.trim(),
        deletedById: req.user?.userId ?? null,
        deletedAt: new Date(),
      },
    });

    if (review.reviewType === "ITEM") {
      const agg = await prisma.review.aggregate({
        where: { itemId: review.itemId, reviewType: "ITEM", isDeleted: false },
        _avg: { rating: true },
      });
      await prisma.item.update({
        where: { id: review.itemId },
        data: { averageRating: agg._avg.rating ?? 0 },
      });
    }

    logger.info(`Admin ${req.user?.userId} removed review ${id} (${reason.trim()})`);
    await recordAudit(req, {
      action: "review.delete",
      targetType: "review",
      targetId: id,
      reason: reason.trim(),
    });

    res.json({ success: true, message: "Review removed" });
  } catch (error) {
    next(error);
  }
};

// ─── Audit log (checklist Stage 9) ─────────────────────────────────────────

/**
 * GET /admin/audit-log
 * Oldest-first would starve nothing here (there's no queue to clear), so
 * this is newest-first — the normal "what just happened" read pattern.
 */
export const listAuditLog = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { actorId, targetType, action, page = "1", limit = "50" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = Math.min(200, parseInt(limit as string));

    const where: Prisma.AuditLogWhereInput = {
      ...(actorId ? { actorId: String(actorId) } : {}),
      ...(targetType ? { targetType: String(targetType) } : {}),
      ...(action ? { action: String(action) } : {}),
    };

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        entries,
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

// ─── User detail (checklist Stage 9) ───────────────────────────────────────

/**
 * GET /admin/users/:id
 * The admin console's user detail page previously had no dedicated
 * endpoint at all — it resolved a single user by filtering the full
 * GET /admin/users list client-side. This is the real thing: one user
 * plus their listings, reviews, payout destination, and rental history
 * in a single call, not a client-side find() over an already-loaded page.
 */
export const getUserDetail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        studentId: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        profileImage: true,
        isVerified: true,
        verificationStatus: true,
        isActive: true,
        role: true,
        createdAt: true,
        lastLogin: true,
        payoutProvider: true,
        payoutInstitutionName: true,
        payoutAccountName: true,
      },
    });
    if (!user) throw new NotFoundError("User not found");

    const [items, reviewsReceived, rentalsAsOwner, rentalsAsRenter, auditEntries] =
      await Promise.all([
        prisma.item.findMany({
          where: { ownerId: id },
          select: {
            id: true, title: true, isListed: true, isActive: true,
            isFlagged: true, averageRating: true, totalRentals: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.review.findMany({
          where: { recipientId: id, reviewType: "USER", isDeleted: false },
          include: { author: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.rental.count({ where: { ownerId: id } }),
        prisma.rental.count({ where: { renterId: id } }),
        prisma.auditLog.findMany({
          where: { targetType: "user", targetId: id },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

    res.json({
      success: true,
      data: {
        user,
        items,
        reviewsReceived,
        rentalCounts: { asOwner: rentalsAsOwner, asRenter: rentalsAsRenter },
        auditEntries,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Bulk item moderation (checklist Stage 9) ──────────────────────────────

const BULK_ITEM_ACTIONS = ["UNLIST", "RELIST", "FLAG", "UNFLAG"] as const;

/**
 * PATCH /admin/items/bulk
 * Same rules as the single-item moderateItem (a reason is required for
 * UNLIST/FLAG, not for the reversals) — "moderating a spam wave" was
 * previously one row at a time with nothing else available.
 */
export const bulkModerateItems = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { itemIds, action, reason } = req.body as {
      itemIds?: string[];
      action?: string;
      reason?: string;
    };

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      throw new ValidationError("itemIds must be a non-empty array");
    }
    if (itemIds.length > 100) {
      throw new ValidationError("Cannot moderate more than 100 items at once");
    }
    if (!action || !BULK_ITEM_ACTIONS.includes(action as never)) {
      throw new ValidationError(
        `action must be one of: ${BULK_ITEM_ACTIONS.join(", ")}`,
      );
    }
    if ((action === "UNLIST" || action === "FLAG") && !reason?.trim()) {
      throw new ValidationError(`A reason is required to ${action.toLowerCase()} items`);
    }

    const data: Prisma.ItemUpdateInput = {
      moderatedById: req.user?.userId ?? null,
      moderatedAt: new Date(),
    };
    switch (action) {
      case "UNLIST": data.isListed = false; break;
      case "RELIST": data.isListed = true; break;
      case "FLAG": data.isFlagged = true; data.flagReason = reason?.trim(); break;
      case "UNFLAG": data.isFlagged = false; data.flagReason = null; break;
    }

    const result = await prisma.item.updateMany({
      where: { id: { in: itemIds } },
      data,
    });

    logger.info(
      `Admin ${req.user?.userId} bulk-${action} ${result.count} item(s)${reason ? ` (${reason})` : ""}`,
    );
    await recordAudit(req, {
      action: `item.bulk${action.charAt(0)}${action.slice(1).toLowerCase()}`,
      targetType: "item",
      reason: reason?.trim() || null,
      metadata: { itemIds, count: result.count },
    });

    res.json({ success: true, message: `${result.count} item(s) updated`, data: { count: result.count } });
  } catch (error) {
    next(error);
  }
};
