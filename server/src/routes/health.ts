import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { redis } from "../redis.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async (_req, reply) => {
    const checks: Record<string, string> = { api: "ok" };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = "ok";
    } catch {
      checks.db = "down";
    }
    try {
      await redis.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "down";
    }
    const healthy = Object.values(checks).every((v) => v === "ok");
    return reply.status(healthy ? 200 : 503).send({ status: healthy ? "ok" : "degraded", checks });
  });
}