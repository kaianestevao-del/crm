import Redis from "ioredis";
import { env } from "./env";

export const redisConnection = { url: env.REDIS_URL };

export function createRedisClient() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
