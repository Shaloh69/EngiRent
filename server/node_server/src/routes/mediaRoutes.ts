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
    res.setHeader("Content-Type", contentTypeFor(relativePath));
    res.setHeader("Cache-Control", "private, max-age=300");
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
