import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth";
import { uploadSingle, uploadMultiple } from "../middleware/upload";
import { uploadFile, FOLDERS } from "../services/storageService";
import { v4 as uuidv4 } from "uuid";
import path from "path";

const router = Router();

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
      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      const filename = `${uuidv4()}${ext}`;
      const url = await uploadFile(
        FOLDERS.ITEMS,
        filename,
        req.file.buffer,
        req.file.mimetype,
      );
      res.json({ success: true, url });
    } catch (error) {
      next(error);
    }
  },
);

// POST /upload/images — multiple files (up to 10)
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
      const urls = await Promise.all(
        files.map((file) => {
          const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
          const filename = `${uuidv4()}${ext}`;
          return uploadFile(
            FOLDERS.ITEMS,
            filename,
            file.buffer,
            file.mimetype,
          );
        }),
      );
      res.json({ success: true, urls });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
