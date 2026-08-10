import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { UnauthorizedError, ForbiddenError } from "../utils/errors";
import prisma from "../config/database";

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    studentId: string;
    role: "STUDENT" | "ADMIN" | "REVIEWER";
  };
}

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("No token provided");
    }

    const token = authHeader.substring(7);

    try {
      const decoded = verifyAccessToken(token);

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          studentId: true,
          isActive: true,
          role: true,
        },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedError("User not found or inactive");
      }

      req.user = {
        userId: user.id,
        email: user.email,
        studentId: user.studentId,
        role: user.role as "STUDENT" | "ADMIN" | "REVIEWER",
      };

      next();
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }
  } catch (error) {
    next(error);
  }
};

export const requireAdmin = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    next(new UnauthorizedError("Authentication required"));
    return;
  }
  if (req.user.role !== "ADMIN") {
    next(new ForbiddenError("Admin access required"));
    return;
  }
  next();
};

// Checklist Stage 9 — admin role granularity. REVIEWER can reach the
// review-queue-clearing routes (ID verification decisions, item
// moderation, feedback triage) this gates; everything else (payments,
// disputes, kiosk config, other admin accounts, settings) stays
// requireAdmin-only, i.e. REVIEWER-exclusive.
export const requireStaff = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    next(new UnauthorizedError("Authentication required"));
    return;
  }
  if (req.user.role !== "ADMIN" && req.user.role !== "REVIEWER") {
    next(new ForbiddenError("Admin or reviewer access required"));
    return;
  }
  next();
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);

      try {
        const decoded = verifyAccessToken(token);
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            email: true,
            studentId: true,
            isActive: true,
            role: true,
          },
        });

        if (user && user.isActive) {
          req.user = {
            userId: user.id,
            email: user.email,
            studentId: user.studentId,
            role: user.role as "STUDENT" | "ADMIN" | "REVIEWER",
          };
        }
      } catch {
        // Token invalid — continue without auth
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};
