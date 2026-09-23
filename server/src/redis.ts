import { Redis } from "ioredis";
import { env } from "./env.js";

/**
 * Redis is optional. Local development can use it for the sliding-window
 * limiter; serverless deployments must not depend on it, because a TCP Redis
 * connection cannot be held across function suspensions. When `REDIS_URL` is
 * unset, `lib/limiter.ts` falls back to a Postgres counter.
 */
export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 200, 1000)),
    })
  : null;

redis?.on("error", (err: Error) => {
  console.error("[redis] error", err.message);
});

/** Connect on first use; null when Redis is not configured or unreachable. */
export async function redisReady(): Promise<Redis | null> {
  if (!redis) return null;
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    await redis.ping();
    return redis;
  } catch {
    return null;
  }
}