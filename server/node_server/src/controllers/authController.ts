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
        parentName,
        parentContact,
      },
      select: {
        id: true,
        email: true,
        studentId: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        isVerified: true,
        role: true,
        createdAt: true,
      },
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
          profileImage: user.profileImage,
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
      select: {
        id: true,
        email: true,
        studentId: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        profileImage: true,
        parentName: true,
        parentContact: true,
        isVerified: true,
        isActive: true,
        role: true,
        lastLogin: true,
        createdAt: true,
      },
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

    const {
      firstName,
      lastName,
      phoneNumber,
      parentName,
      parentContact,
      profileImage,
    } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(phoneNumber && { phoneNumber }),
        ...(parentName && { parentName }),
        ...(parentContact && { parentContact }),
        ...(profileImage && { profileImage }),
      },
      select: {
        id: true,
        email: true,
        studentId: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        profileImage: true,
        parentName: true,
        parentContact: true,
        isVerified: true,
        updatedAt: true,
      },
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
