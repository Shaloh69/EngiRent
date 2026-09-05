import { Request, Response, NextFunction } from "express";
import {
  avatarUrl,
  publicItemUrl,
  signedMediaUrl,
  toRelativeMediaPath,
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
// A raw stored path missing this rewrite would otherwise leak into a
// response as a bare, meaningless string — this makes it structurally
// impossible to forget at any individual call site.

const FACE_PATH_RE = /^users\/([^/]+)\/face\.jpg$/;
const PRIVATE_PATH_RE = /^(users\/[^/]+\/id\.jpg|verifications\/.+)$/;
// Item photos and listing clips are public and unsigned, but they must still
// be stored relative and built here — see toRelativeMediaPath()'s comment and
// defects D-17/D-18. Previously these were persisted as absolute URLs with the
// then-current Cloudflare hostname baked in, which broke every listing photo
// (and, silently, the whole ML verification path) on each tunnel rotation.
const ITEM_PATH_RE = /^items\/[^/]+\/[^/]+$/;

function rewriteValue(value: unknown): unknown {
  if (typeof value === "string") {
    // Normalise first: a value may be a stored relative path (the correct,
    // current form) OR a legacy absolute URL with a long-dead Cloudflare
    // hostname baked into it. Matching on the normalised path means both are
    // rebuilt against the CURRENT host, so historical rows heal on read instead
    // of staying broken until someone runs a migration (D-17).
    const rel = toRelativeMediaPath(value);
    const faceMatch = rel.match(FACE_PATH_RE);
    if (faceMatch) return avatarUrl(faceMatch[1]);
    if (PRIVATE_PATH_RE.test(rel)) return signedMediaUrl(rel);
    if (ITEM_PATH_RE.test(rel)) return publicItemUrl(rel);
    return value;
  }
  if (Array.isArray(value)) return value.map(rewriteValue);
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteValue(v);
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
  res.json = ((body?: unknown) => originalJson(rewriteValue(body))) as typeof res.json;
  next();
}
