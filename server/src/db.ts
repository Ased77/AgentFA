import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { env, isProd } from "./env.js";

const globalForPrisma = globalThis as unknown as { __agentfaPrisma?: PrismaClient };

function createClient(): PrismaClient {
  // One pool per warm instance. Serverless platforms suspend instances at any
  // time, so the pool stays small and (on Vercel) is registered with
  // `attachDatabasePool` so idle connections are released before suspension.
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  if (process.env.VERCEL) attachDatabasePool(pool);

  return new PrismaClient({
    adapter: new PrismaPg(pool),
    log: isProd() ? ["error"] : ["warn", "error"],
  });
}

/** Reused across warm invocations (Fluid compute). */
export const prisma = (globalForPrisma.__agentfaPrisma ??= createClient());