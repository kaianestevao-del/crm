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
};
