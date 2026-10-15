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

/**
 * Face liveness (2026-10-15): one frame per step plus the centred frame. The
 * old single `file` field is still ACCEPTED here only so an app from before
 * the revamp gets "update the app" (faceLivenessService.readFaceFrames)
 * instead of multer's "Unexpected field".
 */
export const uploadFaceFrames = multerConfig.fields([
  { name: "centre", maxCount: 1 },
  { name: "blink", maxCount: 1 },
  { name: "turn_left", maxCount: 1 },
  { name: "turn_right", maxCount: 1 },
  // Optional extra candidates for the blink (a blink is ~150 ms; one frame can
  // miss the closed moment). ML keeps the one with the most closed eyes.
  { name: "blink2", maxCount: 1 },
  { name: "blink3", maxCount: 1 },
  { name: "file", maxCount: 1 },
]);

/** Accept up to 10 files under the field name `files` */
export const uploadMultiple = multerConfig.array("files", 10);

/**
 * Concerns v2 evidence: up to 5 `photos` and 1 `video` in one request. The 40 MB
 * ceiling exists ONLY here (a 30 s phone video at medium resolution); every other
 * upload keeps MAX_FILE_SIZE. Types are checked again from the bytes on save
 * (concernService.sniffEvidence), never trusted from the client.
 */
export const uploadEvidence = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (/^(image\/|video\/)/.test(file.mimetype) || file.mimetype === "application/octet-stream") cb(null, true);
    else cb(new Error(`File type ${file.mimetype} is not allowed`));
  },
}).fields([
  { name: "photos", maxCount: 5 },
  { name: "video", maxCount: 1 },
]);
