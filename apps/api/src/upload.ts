import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

const uploadsRoot = path.join(__dirname, "..", "uploads");

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
