import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: required("REDIS_URL"),
  SESSIONS_DIR: process.env.SESSIONS_DIR ?? "./sessions",
  // Where inbound/historical media gets saved. Defaults to the API's own uploads folder,
  // assuming both processes run on the same host (true for the single-VPS deployment this
  // project targets) — the API serves that same directory statically at /uploads.
  UPLOADS_DIR: process.env.UPLOADS_DIR ?? "../api/uploads",
  // Used to build the absolute URL for a just-downloaded file so the transcription queue
  // (and, for outbound sends, Baileys itself) can fetch it over HTTP.
  PUBLIC_URL: process.env.PUBLIC_URL ?? "http://localhost:4000",

  // Daily backup (see backup/daily-backup-worker.ts) — every field here is optional so the
  // worker still starts without them; each delivery channel just logs and skips itself when
  // its own config is missing, instead of the whole feature being all-or-nothing.
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM ?? process.env.SMTP_USER,
  BACKUP_EMAIL_TO: process.env.BACKUP_EMAIL_TO,
  // DDI+DDD+número, dígitos só (ex: 5575998575537) — o próprio número de WhatsApp do dono
  // que deve receber o arquivo de backup.
  BACKUP_WHATSAPP_NUMBER: process.env.BACKUP_WHATSAPP_NUMBER,
};
