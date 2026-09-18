import { Redis } from "ioredis";
import { env } from "./env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("error", (err) => {
  console.error("[redis] error", err.message);
});

/**
 * Sliding-window rate limit. Returns whether the call is allowed and how many
 * hits are in the window afterwards. Mirrors the client-side limits that used
 * to live in `agentfa-web/src/lib/mock-store.ts:114`.
 */
export async function rateLimit(
  key: string,
  limits: { windowSeconds: number; max: number }[],
): Promise<{ ok: boolean; retryAfter?: number }> {
  const now = Date.now();
  const pipeline = redis.pipeline();
  for (const limit of limits) {
    const bucket = `rl:${key}:${limit.windowSeconds}`;
    pipeline.zremrangebyscore(bucket, 0, now - limit.windowSeconds * 1000);
    pipeline.zcard(bucket);
  }
  const results = await pipeline.exec();
  if (!results) return { ok: true };

  for (let i = 0; i < limits.length; i++) {
    const count = Number(results[i * 2 + 1]?.[1] ?? 0);
    if (count >= limits[i].max) {
      return { ok: false, retryAfter: limits[i].windowSeconds };
    }
  }

  const record = redis.pipeline();
  for (const limit of limits) {
    const bucket = `rl:${key}:${limit.windowSeconds}`;
    record.zadd(bucket, now, `${now}-${Math.random().toString(36).slice(2)}`);
    record.expire(bucket, limit.windowSeconds + 1);
  }
  await record.exec();
  return { ok: true };
}