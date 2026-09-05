import Redis from "ioredis";
import { env } from "./env";

export function createRedisClient() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
