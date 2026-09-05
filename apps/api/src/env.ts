import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(10),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // Base URL the worker uses to fetch uploaded media (quick replies, attachments) over HTTP,
  // since the worker process may run on a different host than the API.
  PUBLIC_URL: z.string().default("http://localhost:4000"),
});

export const env = envSchema.parse(process.env);
