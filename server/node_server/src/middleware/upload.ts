import multer from "multer";
import { Request } from "express";
import env from "../config/env";

// Actually controlled by ALLOWED_FILE_TYPES/MAX_FILE_SIZE now — these two env
// vars previously existed in the schema but were silently ignored here,
// which meant the config surface claimed something was configurable when it
// wasn't. video/mp4 and application/octet-stream are included in the
// .env.example default because Android camera packages often send the
// latter for what is actually a JPEG — dropping it from a real deployment's
// env value would break mobile-app photo uploads.
const ALLOWED_MIMETYPES = env.ALLOWED_FILE_TYPES.split(",").map((t) => t.trim());
const MAX_FILE_SIZE = parseInt(env.MAX_FILE_SIZE, 10);

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  }
};

const storage = multer.memoryStorage();

const multerConfig = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

/** Accept a single file under the field name `file` */
export const uploadSingle = multerConfig.single("file");

/** Accept up to 10 files under the field name `files` */
export const uploadMultiple = multerConfig.array("files", 10);
