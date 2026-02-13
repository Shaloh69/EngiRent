import { Request, Response, NextFunction } from 'express';
import env from '../config/env';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

const windowMs = parseInt(env.RATE_LIMIT_WINDOW_MS);
const maxRequests = parseInt(env.RATE_LIMIT_MAX_REQUESTS);

export const rateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const key = req.ip || 'unknown';
  const now = Date.now();

  if (!store[key] || now > store[key].resetTime) {
    store[key] = {
      count: 1,
      resetTime: now + windowMs,
    };
    next();
    return;
  }

  if (store[key].count >= maxRequests) {
    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((store[key].resetTime - now) / 1000),
    });
    return;
  }

  store[key].count++;
  next();
};

// Clean up old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach((key) => {
    if (now > store[key].resetTime) {
      delete store[key];
    }
  });
}, 10 * 60 * 1000);
