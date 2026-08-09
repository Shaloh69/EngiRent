import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import env from "../config/env";

/**
 * Local filesystem storage — replaces Supabase Storage entirely (Phase 0.5).
 *
 * Directory layout under STORAGE_DIR, by data type and sensitivity — the
 * point of structuring it this way (rather than one flat directory) is the
 * same reason a public Supabase bucket was a problem: everything in one
 * undifferentiated place is either all-public or all-locked-down, neither of
 * which is actually correct here.
 *
 *   storage/
 *   ├── items/{batchId}/{filename}                — item listing photos.
 *   │     Not sensitive; served via a plain (but path-traversal-safe) route,
 *   │     same as browsing a listing was always meant to work.
 *   ├── verifications/{rentalId}/{timestamp}-{uuid}.jpg — kiosk locker/face
 *   │     captures (deposit and return both land here, not split into
 *   │     sub-folders — the kiosk's own upload call has no clean way to know
 *   │     which stage a capture belongs to without a larger protocol change,
 *   │     and the Rental/Verification DB records are the authoritative
 *   │     source for that distinction anyway, not the file path).
 *   │     Sensitive (evidence photos tied to a specific rental dispute/audit
 *   │     trail) — served only via signMediaPath()'s short-lived token.
 *   └── users/{userId}/
 *         face.jpg   — the registration selfie. Also does double duty as the
 *                      public-facing avatar shown when browsing another
 *                      user's listings/rentals/reviews (a pre-existing
 *                      product behavior, not introduced here) — so this one
 *                      is protected by requiring *any* authenticated user
 *                      (see requireAuth on the /media/users/:id/face.jpg
 *                      route), not a signed token, which would break normal
 *                      marketplace browsing. It is *not* publicly reachable
 *                      by an anonymous request, which is the actual gap this
 *                      migration closes (the old Supabase bucket was fully
 *                      public with no auth check at all).
 *         id.jpg     — school ID card photo. No legitimate reason for any
 *                      user other than the owner (or an admin) to see this —
 *                      always served via signMediaPath(), never directly.
 *
 * `batchId` for item photos is a fresh UUID generated at upload time, not
 * literally the eventual Item.id — the upload routes run before an Item
 * record exists (photos are uploaded first, then POST /items references
 * the resulting URLs), so the real itemId isn't known yet. This still
 * achieves the actual goal (grouped, not flat-dumped) without requiring a
 * larger upload-flow redesign.
 */

const STORAGE_ROOT = path.resolve(process.cwd(), env.STORAGE_DIR);

/** Resolves a relative storage path to an absolute one, refusing anything
 * that would escape STORAGE_ROOT (path traversal via `..`, absolute paths,
 * etc.) — every read/write/delete goes through this. */
function resolveSafePath(relativePath: string): string {
  const resolved = path.resolve(STORAGE_ROOT, relativePath);
  const withSep = STORAGE_ROOT.endsWith(path.sep)
    ? STORAGE_ROOT
    : STORAGE_ROOT + path.sep;
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(withSep)) {
    throw new Error(`Refusing to access path outside storage root: ${relativePath}`);
  }
  return resolved;
}

export async function saveBuffer(
  relativePath: string,
  buffer: Buffer,
): Promise<void> {
  const abs = resolveSafePath(relativePath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
}

export async function readStoredFile(relativePath: string): Promise<Buffer> {
  const abs = resolveSafePath(relativePath);
  return fsp.readFile(abs);
}

export async function storedFileExists(relativePath: string): Promise<boolean> {
  try {
    await fsp.access(resolveSafePath(relativePath), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function deleteStoredPath(relativePath: string): Promise<void> {
  try {
    await fsp.unlink(resolveSafePath(relativePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ── Path builders ───────────────────────────────────────────────────────────

export function itemImagePath(batchId: string, filename: string): string {
  return `items/${batchId}/${filename}`;
}
export function userFacePath(userId: string): string {
  return `users/${userId}/face.jpg`;
}
export function userIdPath(userId: string): string {
  return `users/${userId}/id.jpg`;
}
export function verificationImagePath(rentalId: string, filename: string): string {
  return `verifications/${rentalId}/${filename}`;
}
/** A feedback report's optional screenshot. Private, same tier as face/ID
 * photos — never served directly (see mediaRoutes), only through
 * signedMediaUrl() — because a screenshot can incidentally contain anything
 * that was on the student's screen: their own rental details, a payment
 * error with an amount, another student's listing they had open. */
export function feedbackScreenshotPath(feedbackId: string, filename: string): string {
  return `feedback/${feedbackId}/${filename}`;
}

// ── URL builders ─────────────────────────────────────────────────────────

/** Public, unsigned URL for a non-sensitive item photo. Path-traversal-safe
 * at the serving route, but otherwise reachable by anyone — same as normal
 * marketplace listing photos always were. */
export function publicItemUrl(relativePath: string): string {
  if (!relativePath.startsWith("items/")) {
    throw new Error(`publicItemUrl() called with a non-item path: ${relativePath}`);
  }
  return `${env.API_PUBLIC_URL}/media/${relativePath}`;
}

/** Authenticated-only (any logged-in user) URL for a user's avatar/selfie —
 * not signed/expiring, but not publicly reachable by an anonymous request
 * either. See userFacePath() doc comment for why this tier, not signed. */
export function avatarUrl(userId: string): string {
  return `${env.API_PUBLIC_URL}/media/users/${userId}/face.jpg`;
}

// ── Signed URLs (ID photos, verification images) ──────────────────────────

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", env.MEDIA_SIGNING_KEY)
    .update(payload)
    .digest("base64url");
}

/** Produces a compact, URL-safe, tamper-evident, time-limited token
 * encoding `relativePath`. Format: base64url(path).base64url(expiry).sig */
export function signMediaPath(
  relativePath: string,
  ttlSeconds = Number(env.MEDIA_SIGNED_URL_TTL_SECONDS),
): string {
  const expiry = Date.now() + ttlSeconds * 1000;
  const pathPart = Buffer.from(relativePath, "utf8").toString("base64url");
  const expPart = Buffer.from(String(expiry), "utf8").toString("base64url");
  const sig = sign(`${pathPart}.${expPart}`);
  return `${pathPart}.${expPart}.${sig}`;
}

/** Verifies a token from signMediaPath(); returns the relative path if valid
 * and unexpired, or null otherwise (bad signature, malformed, expired). */
export function verifyMediaToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [pathPart, expPart, sig] = parts;

  const expected = sign(`${pathPart}.${expPart}`);
  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  const expiry = Number(Buffer.from(expPart, "base64url").toString("utf8"));
  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;

  return Buffer.from(pathPart, "base64url").toString("utf8");
}

/** Signed, short-lived URL for a private file (ID photo, verification image).
 * Returns null if `relativePath` is null/undefined, for convenient chaining
 * against optional DB fields. */
export function signedMediaUrl(
  relativePath: string | null | undefined,
): string | null {
  if (!relativePath) return null;
  return `${env.API_PUBLIC_URL}/media/secure/${signMediaPath(relativePath)}`;
}

/** Maps signedMediaUrl() over an array of stored paths (Verification's
 * originalImages/kioskImages), dropping any null/undefined entries. */
export function signedMediaUrls(
  relativePaths: unknown,
): string[] {
  if (!Array.isArray(relativePaths)) return [];
  return relativePaths
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map((p) => signedMediaUrl(p) as string);
}
