import multer from "multer";
import { Request } from "express";

const ALLOWED_MIMETYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "video/mp4",
  "application/octet-stream", // camera packages on Android often send this
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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
