import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';
import { Prisma } from '@prisma/client';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error('Error:', err);

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: 'Resource already exists',
        message: 'A unique constraint violation occurred',
      });
      return;
    }

    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: 'Not found',
        message: 'Resource not found',
      });
      return;
    }
  }

  // Application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
    return;
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: 'Validation error',
      message: err.message,
    });
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
    return;
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: 'Token expired',
    });
    return;
  }

  // Default error
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && {
      message: err.message,
      stack: err.stack,
    }),
  });
};

export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
  });
};
