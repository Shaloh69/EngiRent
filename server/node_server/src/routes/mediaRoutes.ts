import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import { authenticate } from "../middleware/auth";
import {
  readStoredFile,
  storedFileExists,
  verifyMediaToken,
} from "../services/storageService";
import { NotFoundError } from "../utils/errors";

const router = Router();

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Content type from the file's own magic bytes, falling back to its
 * extension.
 *
 * The extension alone is not trustworthy here: uploads are stored at fixed
 * paths (`users/{id}/id.jpg`, `face.jpg`) whatever format the client actually
 * sent, and the upload middleware genuinely accepts PNG and WebP as well as
 * JPEG. Combined with the `nosniff` header helmet sets, mislabelling a PNG as
 * image/jpeg makes the browser refuse to decode it — which showed up as an
 * admin staring at a blank evidence pane with no error.
 */
function sniffContentType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "video/mp4";
  }
  return null;
}

function contentTypeFor(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

async function serveRelativePath(
  relativePath: string,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!(await storedFileExists(relativePath))) {
      throw new NotFoundError("Image not found");
    }
    const buffer = await readStoredFile(relativePath);
    res.setHeader(
      "Content-Type",
      sniffContentType(buffer) ?? contentTypeFor(relativePath),
    );
    res.setHeader("Cache-Control", "private, max-age=300");
    // helmet() sets Cross-Origin-Resource-Policy: same-origin globally, which
    // is right for the API's JSON but wrong for images that are *meant* to be
    // embedded by our own front-ends. The Admin Console runs on a different
    // origin from the API, so every evidence photo it tried to display was
    // blocked with ERR_BLOCKED_BY_RESPONSE.NotSameOrigin and rendered as an
    // empty box — no console error the reviewer would ever see.
    //
    // This is not a loosening of access control: these bytes are already
    // gated by the signed token (or by authenticate()) on the way in. CORP
    // governs who may *embed* an already-authorised response, not who may
    // fetch it.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

// Item listing photos — not sensitive, reachable without auth (same as
// normal marketplace listing browsing always was), but only ever resolved
// through resolveSafePath() inside storageService, so `..`/absolute-path
// traversal attempts are rejected rather than escaping the storage root.
// Express's own route param matching (:batchId/:filename) already forbids
// literal `/` in each segment, which is the main traversal vector here.
router.get(
  "/items/:batchId/:filename",
  (req: Request, res: Response, next: NextFunction) => {
    const { batchId, filename } = req.params;
    void serveRelativePath(`items/${batchId}/${filename}`, res, next);
  },
);

// User avatar/registration selfie — requires *some* authenticated user (not
// necessarily the owning one), matching the existing product behavior of
// showing an owner's photo to other users browsing their listings/rentals/
// reviews. This is not "fully public" (the actual gap being closed — the old
// Supabase bucket had no auth check of any kind), and not a single-use
// signed token either (that would break normal repeat browsing). See the
// doc comment on userFacePath() in storageService.ts for the full reasoning.
router.get(
  "/users/:userId/face.jpg",
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req.params;
    void serveRelativePath(`users/${userId}/face.jpg`, res, next);
  },
);

// Signed, short-lived access to anything sensitive — ID photos, kiosk
// verification images. The token itself (from signMediaPath()) is the only
// credential; no separate login is required because the token is already
// scoped to one specific file and expires (see MEDIA_SIGNED_URL_TTL_SECONDS).
router.get(
  "/secure/:token",
  (req: Request, res: Response, next: NextFunction) => {
    const token = String(req.params.token);
    const relativePath = verifyMediaToken(token);
    if (!relativePath) {
      res.status(403).json({
        success: false,
        message: "Invalid or expired media link",
      });
      return;
    }
    void serveRelativePath(relativePath, res, next);
  },
);

export default router;
