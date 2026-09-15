import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { env } from "./env";

const uploadsRoot = path.resolve(env.UPLOADS_DIR);

function diskStorage(subdir: string) {
  const dir = path.join(uploadsRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: dir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });
}

export const uploadMessageAttachment = multer({
  storage: diskStorage("messages"),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export const uploadQuickReplyMedia = multer({
  storage: diskStorage("quick-replies"),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Parsed once for its rows and discarded — nothing to serve later, so no disk storage needed.
export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
