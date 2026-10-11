import { Request, Response, NextFunction } from "express";
import {
  avatarUrl,
  publicItemUrl,
  signedMediaUrl,
  toRelativeMediaPath,
  pathFromOwnMediaToken,
} from "../services/storageService";

// Rather than manually converting every controller's `profileImage`/
// `idImageUrl`/`Verification.originalImages`/`kioskImages` field at each of
// the ~15+ places they're selected and returned across itemController,
// rentalController, reviewController, kioskController, adminController, and
// index.ts's socket handlers, this middleware intercepts every outgoing
// res.json() call once, globally, and rewrites any stored relative path it
// finds into the correct URL for its sensitivity tier:
//   users/{id}/face.jpg  → an authenticated-route URL (any logged-in user;
//                          this doubles as the public-facing avatar, see the
//                          doc comment on userFacePath() in storageService.ts)
//   users/{id}/id.jpg,
//   verifications/**      → a short-lived signed URL (never a stored,
//                          permanent, or guessable link)
//
// SECURITY FIX 2026-10-11 — ONLY THE MEDIA COLUMNS, BY KEY. This used to
// rewrite ANY string anywhere in a response that matched a private path, so a
// student who sent a chat message (or wrote an item description, a review, a
// feedback report, a name) consisting of exactly `users/<someone's id>/id.jpg`
// got back a working signed link to that person's ID photo: the server signed
// attacker-chosen text. Rewriting is now limited to the keys that hold paths
// the SERVER wrote (MEDIA_KEYS), and free text is never touched.
//
// Also heals our own EXPIRED signed links stored in those columns (the kiosk's
// upload hands back signed URLs and they are stored verbatim in
// `Verification.kioskImages`, so every locker photo older than the TTL broke).
// Only a link whose signature verifies is re-signed: see pathFromOwnMediaToken.

const MEDIA_KEYS = new Set([
  "profileImage",
  "idImageUrl",
  "images",
  "originalImages",
  "kioskImages",
  "videoUrl",
]);

const FACE_PATH_RE = /^users\/([^/]+)\/face\.jpg$/;
const PRIVATE_PATH_RE = /^(users\/[^/]+\/id\.jpg|verifications\/.+)$/;
// Item photos and listing clips are public and unsigned, but they must still
// be stored relative and built here — see toRelativeMediaPath()'s comment and
// defects D-17/D-18.
const ITEM_PATH_RE = /^items\/[^/]+\/[^/]+$/;

function rewriteMediaString(value: string): string {
  // A stored signed link of our own (possibly expired): back to its path.
  const own = pathFromOwnMediaToken(value);
  const rel = own ?? toRelativeMediaPath(value);
  const faceMatch = rel.match(FACE_PATH_RE);
  if (faceMatch) return avatarUrl(faceMatch[1]);
  if (PRIVATE_PATH_RE.test(rel)) return signedMediaUrl(rel) as string;
  if (ITEM_PATH_RE.test(rel)) return publicItemUrl(rel);
  return value;
}

function rewriteValue(value: unknown, key: string | null): unknown {
  if (key !== null && MEDIA_KEYS.has(key)) {
    if (typeof value === "string") return rewriteMediaString(value);
    if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? rewriteMediaString(v) : v));
  }
  if (Array.isArray(value)) return value.map((v) => rewriteValue(v, null));
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteValue(v, k);
    return out;
  }
  return value;
}

export function mediaUrlRewriter(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => originalJson(rewriteValue(body, null))) as typeof res.json;
  next();
}

/** Test seam. */
export const __rewriteForTest = (body: unknown) => rewriteValue(body, null);
