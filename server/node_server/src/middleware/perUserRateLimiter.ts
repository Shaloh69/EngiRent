import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

/**
 * A stricter, per-user limiter for endpoints where the global IP-keyed
 * `rateLimiter` (see rateLimiter.ts) isn't the right shape — a shared campus
 * NAT/wifi means many students share one IP, so an IP-keyed limit either
 * punishes everyone behind it or has to be so loose it stops nothing.
 * Feedback submission needs the opposite: cheap for one legitimate report,
 * expensive for one account spamming the triage queue.
 *
 * In-memory only, no disk snapshot — unlike the global limiter this guards a
 * low-stakes write path, not auth, so losing the window on a rare restart is
 * an acceptable trade for not adding disk I/O to every feedback submission.
 */
export function createPerUserRateLimiter(opts: {
  windowMs: number;
  max: number;
  message: string;
}) {
  const hits = new Map<string, { count: number; resetTime: number }>();

  // Periodic sweep so the map doesn't grow unbounded across a long-running
  // process — mirrors the pattern in rateLimiter.ts.
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of hits) {
        if (now > entry.resetTime) hits.delete(key);
      }
    },
    10 * 60 * 1000,
  ).unref();

  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const key = req.user?.userId;
    // No authenticated user means `authenticate` already rejected the
    // request upstream; fail open here rather than keying on "undefined"
    // and accidentally sharing one bucket across every unauthenticated call.
    if (!key) {
      next();
      return;
    }

    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetTime) {
      hits.set(key, { count: 1, resetTime: now + opts.windowMs });
      next();
      return;
    }

    if (entry.count >= opts.max) {
      res.status(429).json({
        success: false,
        error: "Too many requests",
        message: opts.message,
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
      });
      return;
    }

    entry.count++;
    next();
  };
}
