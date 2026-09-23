import { Prisma } from "@prisma/client";
import type { Redis } from "ioredis";
import { prisma } from "../db.js";
import { redisReady } from "../redis.js";
import { tooMany } from "./errors.js";
import { retryAfter, windowStart, type Limit } from "./window.js";

export type LimitResult = { ok: boolean; retryAfter?: number };

export type { Limit } from "./window.js";

/** Stale counters are deleted opportunistically instead of by a scheduler. */
const CLEANUP_CHANCE = 0.01;
const CLEANUP_AFTER_MS = 25 * 60 * 60 * 1000;

/**
 * Fixed-window counters in Postgres. Serverless functions cannot hold a Redis
 * connection across suspensions, so this is the default in production: one
 * atomic upsert per window, executed in a single transaction.
 */
async function postgresLimit(key: string, limits: Limit[]): Promise<LimitResult> {
  const now = Date.now();
  const counters = await prisma.$transaction(
    limits.map((limit) =>
      prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
        INSERT INTO "RateLimit" ("key", "windowStart", "count")
        VALUES (
          ${`${key}:${limit.windowSeconds}`},
          ${new Date(windowStart(now, limit.windowSeconds))},
          1
        )
        ON CONFLICT ("key", "windowStart")
        DO UPDATE SET "count" = "RateLimit"."count" + 1
        RETURNING "count"
      `),
    ),
  );

  for (let i = 0; i < limits.length; i += 1) {
    const count = Number(counters[i]?.[0]?.count ?? 0);
    if (count > limits[i].max) {
      return { ok: false, retryAfter: retryAfter(now, limits[i].windowSeconds) };
    }
  }

  if (Math.random() < CLEANUP_CHANCE) {
    void prisma
      .$executeRaw`DELETE FROM "RateLimit" WHERE "windowStart" < ${new Date(now - CLEANUP_AFTER_MS)}`
      .catch(() => {});
  }
  return { ok: true };
}

/** Sliding-window counters in Redis. Used when `REDIS_URL` is configured. */
async function redisLimit(client: Redis, key: string, limits: Limit[]): Promise<LimitResult> {
  const now = Date.now();
  const pipeline = client.pipeline();
  for (const limit of limits) {
    const bucket = `rl:${key}:${limit.windowSeconds}`;
    pipeline.zremrangebyscore(bucket, 0, now - limit.windowSeconds * 1000);
    pipeline.zcard(bucket);
  }
  const results = await pipeline.exec();
  if (!results) return { ok: true };

  for (let i = 0; i < limits.length; i += 1) {
    const count = Number(results[i * 2 + 1]?.[1] ?? 0);
    if (count >= limits[i].max) {
      return { ok: false, retryAfter: limits[i].windowSeconds };
    }
  }

  const record = client.pipeline();
  for (const limit of limits) {
    const bucket = `rl:${key}:${limit.windowSeconds}`;
    record.zadd(bucket, now, `${now}-${Math.random().toString(36).slice(2)}`);
    record.expire(bucket, limit.windowSeconds + 1);
  }
  await record.exec();
  return { ok: true };
}

export async function rateLimit(key: string, limits: Limit[]): Promise<LimitResult> {
  const client = await redisReady();
  if (client) return redisLimit(client, key, limits);
  return postgresLimit(key, limits);
}

/** Throwing variant, for call sites that want a 429 raised for them. */
export async function enforceLimit(key: string, limits: Limit[]): Promise<void> {
  const result = await rateLimit(key, limits);
  if (!result.ok) throw tooMany("rate_limited");
}
