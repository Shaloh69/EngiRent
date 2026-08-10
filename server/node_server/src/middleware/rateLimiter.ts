import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import env from "../config/env";
import logger from "../utils/logger";

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
  const key = (req.headers["cf-connecting-ip"] as string | undefined) || req.ip || "unknown";
  const now = Date.now();

  if (!store[key] || now > store[key].resetTime) {
    store[key] = { count: 1, resetTime: now + windowMs };
    dirty = true;
    next();
    return;
  }

  if (store[key].count >= maxRequests) {
    res.status(429).json({
      success: false,
      error: "Too many requests",
      message: "Rate limit exceeded. Please try again later.",
      retryAfter: Math.ceil((store[key].resetTime - now) / 1000),
    });
    return;
  }

  store[key].count++;
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
