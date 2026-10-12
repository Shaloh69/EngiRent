import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import env from "../config/env";
import logger from "../utils/logger";
import { verifyAccessToken } from "../utils/jwt";

// In-memory store, periodically snapshotted to disk so limits survive a
// process restart (a prior version reset entirely on restart, and separately
// skipped /admin/* entirely — see index.ts for the routing fix to the latter).
//
// This is a single local JSON file, not Redis/a shared cache — deliberately.
// The deployment this targets (server/node_server self-hosted as one process
// on one machine, see docs/planning/03-revamp-master.md §3.5) never runs more
// than one instance, so there is no cross-instance state to share; the only
// real gap to close is "survives a restart," which a local file solves
// without adding an entire extra service (and its own health/startup
// dependency) for a single-process deployment. If this API is ever run as
// multiple horizontally-scaled instances, replace this with a real shared
// store (Redis) — the two functions below (`checkAndIncrement`, `snapshot`)
// are the only things that would need to change.

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

type RateLimitStore = Record<string, RateLimitEntry>;

const STORE_PATH = path.join(process.cwd(), "data", "rate-limit-store.json");

function loadStore(): RateLimitStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as RateLimitStore;
    const now = Date.now();
    // Drop anything already expired rather than resurrecting stale windows.
    for (const key of Object.keys(parsed)) {
      if (parsed[key].resetTime <= now) delete parsed[key];
    }
    return parsed;
  } catch {
    return {};
  }
}

let store: RateLimitStore = loadStore();
let dirty = false;

function persist(): void {
  if (!dirty) return;
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store));
    dirty = false;
  } catch (err) {
    logger.warn(`Rate limiter: failed to persist store to disk: ${err}`);
  }
}

// Snapshot periodically (not on every request — that would make every
// request pay a disk-write cost) and on graceful shutdown.
const SNAPSHOT_INTERVAL_MS = 10_000;
const snapshotTimer = setInterval(persist, SNAPSHOT_INTERVAL_MS);
snapshotTimer.unref(); // don't keep the process alive just for this timer
process.on("SIGTERM", persist);
process.on("SIGINT", persist);

const windowMs = parseInt(env.RATE_LIMIT_WINDOW_MS);
const maxRequests = parseInt(env.RATE_LIMIT_MAX_REQUESTS);

/** All authenticated requests from one IP share this many times the per-user limit. */
const AUTHENTICATED_IP_MULTIPLIER = 5;

/** The user id of a request whose access token VERIFIES, else null. Never throws. */
function verifiedUserId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    const payload = verifyAccessToken(header.slice(7));
    return typeof payload.userId === "string" && payload.userId ? payload.userId : null;
  } catch {
    return null;
  }
}

export const rateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // This deployment is only ever reached via a Cloudflare tunnel
  // (cloudflared connects to localhost, no `trust proxy` is configured, and
  // shouldn't be — the tunnel is the only inbound path). Without this,
  // req.ip resolves to 127.0.0.1 for *every* request that arrives through
  // the tunnel, real end users included — one shared bucket for the whole
  // internet, discovered when heavy same-machine E2E testing (which hits
  // localhost directly, bypassing the tunnel, and lands in that same
  // 127.0.0.1 bucket) exhausted it and started 429ing real admin console
  // traffic. CF-Connecting-IP is the real origin IP Cloudflare attaches to
  // every proxied request; prefer it, and only fall back to req.ip for
  // direct-to-localhost traffic (E2E scripts, health checks), which is
  // exactly where a shared/generic bucket is actually fine.
  // Test-suite bypass (E1). The full five-case matrix over 93 endpoints is
  // ~465 requests — roughly 4.6x this window — so the suite cannot run end to
  // end against the deployment without one.
  //
  // Deliberately a SHARED SECRET, not an IP allowlist. The bucket key below is
  // `CF-Connecting-IP`, a *client-supplied* header on any path that does not
  // actually traverse Cloudflare, so an IP allowlist would be trivially
  // spoofable by the very requests it is meant to exclude. A secret is not.
  // Same pattern as KIOSK_SHARED_SECRET elsewhere in this codebase.
  //
  // Fails closed: unset env var means no bypass exists at all, and an empty or
  // mismatched header is ignored. Every use is logged, so it can never quietly
  // become the normal path.
  const bypassSecret = env.RATE_LIMIT_BYPASS_SECRET;
  if (bypassSecret) {
    const offered = req.headers["x-ratelimit-bypass"] as string | undefined;
    if (offered && offered === bypassSecret) {
      logger.warn(
        `Rate limiter bypassed via shared secret for ${req.method} ${req.originalUrl}`,
      );
      next();
      return;
    }
  }

  const ip = (req.headers["cf-connecting-ip"] as string | undefined) || req.ip || "unknown";
  const userId = verifiedUserId(req);

  // 2026-10-12 (found live): the bucket was per IP only, so one phone looping on
  // /auth/profile used up the whole allowance and the admin console on the same
  // IP was refused too. A request with a VERIFIED access token is now counted in
  // its own user's bucket; everything else is counted by IP exactly as before
  // (login and register are unauthenticated, so brute force stays IP-limited).
  // A token only selects a bucket after it verifies: a forged one is just an
  // anonymous request. Authenticated traffic also shares an IP-wide ceiling, so
  // many accounts behind one address cannot be unbounded.
  const keys: { key: string; max: number }[] = userId
    ? [
        { key: `u:${userId}`, max: maxRequests },
        { key: `a:${ip}`, max: maxRequests * AUTHENTICATED_IP_MULTIPLIER },
      ]
    : [{ key: ip, max: maxRequests }];

  const now = Date.now();
  for (const { key, max } of keys) {
    const entry = store[key];
    if (entry && now <= entry.resetTime && entry.count >= max) {
      res.status(429).json({
        success: false,
        error: "Too many requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
      });
      return;
    }
  }
  for (const { key } of keys) {
    const entry = store[key];
    if (!entry || now > entry.resetTime) {
      store[key] = { count: 1, resetTime: now + windowMs };
    } else {
      entry.count++;
    }
  }
  dirty = true;
  next();
};

// Clean up expired entries periodically so the store (and its on-disk
// snapshot) doesn't grow unbounded.
setInterval(
  () => {
    const now = Date.now();
    let changed = false;
    Object.keys(store).forEach((key) => {
      if (now > store[key].resetTime) {
        delete store[key];
        changed = true;
      }
    });
    if (changed) dirty = true;
  },
  10 * 60 * 1000,
).unref();
