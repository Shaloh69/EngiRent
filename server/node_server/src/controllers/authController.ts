import { Response, NextFunction } from "express";
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
  isActive: true,
  role: true,
  lastLogin: true,
  createdAt: true,
} as const;

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
      data: { user, tokens: { accessToken, refreshToken } },
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
    res.json({ success: true, data: { user } });
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
      data: { user: updatedUser },
    });
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

    const { profileImageUrl, idImageUrl, faceEncoding } = req.body;

    if (!profileImageUrl || !idImageUrl) {
      throw new ValidationError(
        "profileImageUrl and idImageUrl are required to complete profile",
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

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        profileImage: profileImageUrl,
        idImageUrl,
        ...(faceEncoding ? { faceEncoding } : {}),
        profileComplete: true,
      },
      select: PROFILE_SELECT,
    });

    logger.info(`Profile completed: ${req.user.email}`);
    res.json({
      success: true,
      message: "Profile completed successfully",
      data: { user: updatedUser },
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
