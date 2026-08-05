import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth";
import { uploadSingle, uploadMultiple } from "../middleware/upload";
import {
  saveBuffer,
  itemImagePath,
  publicItemUrl,
} from "../services/storageService";
import { v4 as uuidv4 } from "uuid";
import path from "path";

const router = Router();

// Both routes below are for *item listing photos only* — not sensitive, so
// they're saved under items/{batchId}/ and served back as a plain (unsigned)
// URL. `batchId` is a fresh UUID per upload call rather than the eventual
// Item.id, because these routes run before the Item record exists (the
// client uploads photos first, then POSTs /items with the resulting URLs).
// Face/ID photos go through POST /auth/register-face + the profile-complete
// flow instead (see authController.ts) — they're a different sensitivity
// tier (private, or authenticated-only) and never touch this router.

// POST /upload/image — single file
router.post(
  "/image",
  authenticate,
  uploadSingle,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: "No file provided" });
        return;
      }
      const batchId = uuidv4();
      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      const filename = `listing-1${ext}`;
      const relativePath = itemImagePath(batchId, filename);
      await saveBuffer(relativePath, req.file.buffer);
      res.json({ success: true, url: publicItemUrl(relativePath) });
    } catch (error) {
      next(error);
    }
  },
);

// POST /upload/images — multiple files (up to 10), grouped under one batch
router.post(
  "/images",
  authenticate,
  uploadMultiple,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ success: false, message: "No files provided" });
        return;
      }
      const batchId = uuidv4();
      const urls = await Promise.all(
        files.map(async (file, i) => {
          const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
          const filename = `listing-${i + 1}${ext}`;
          const relativePath = itemImagePath(batchId, filename);
          await saveBuffer(relativePath, file.buffer);
          return publicItemUrl(relativePath);
        }),
      );
      res.json({ success: true, urls });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
