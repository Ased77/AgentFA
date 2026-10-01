import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { approveRefund, rejectRefund } from "../refunds.js";

/**
 * Admin-only data and actions.
 *
 * The panel used to show hardcoded numbers and buttons that did nothing. These
 * endpoints give it real figures and one real action (settling refunds); the
 * provider configuration lives in `admin-provider.ts`.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    await app.requireAdmin(req, reply);
  });

  /** Counts and revenue the panel reports on. */
  app.get("/stats", async () => {
    const [users, agents, divisions, revenue, tokens, purchases, pendingRefunds] = await Promise.all([
      prisma.user.count(),
      prisma.agent.count(),
      prisma.division.count(),
      prisma.transaction.aggregate({ _sum: { amount: true }, where: { status: "success" } }),
      prisma.usageEvent.aggregate({ _sum: { tokens: true } }),
      prisma.entitlement.count({ where: { revokedAt: null } }),
      prisma.transaction.count({ where: { type: "refund", status: "pending" } }),
    ]);
    return {
      users,
      agents,
      divisions,
      purchases,
      pendingRefunds,
      revenueToman: revenue._sum.amount ?? 0,
      tokensUsed: tokens._sum.tokens ?? 0,
    };
  });

  /** Refund requests waiting on a decision. */
  app.get("/refunds", async () => {
    const refunds = await prisma.transaction.findMany({
      where: { type: "refund", status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        orderId: true,
        userId: true,
        agentId: true,
        amount: true,
        currency: true,
        provider: true,
        createdAt: true,
        user: { select: { phone: true } },
      },
    });
    return { refunds };
  });

  app.post("/refunds/:id/approve", async (req) => {
    const { id } = req.params as { id: string };
    const result = await approveRefund(id);
    return { settled: result.settled };
  });

  app.post("/refunds/:id/reject", async (req) => {
    const parsed = z.object({ reason: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) throw badRequest("reason_required", parsed.error.issues);
    const { id } = req.params as { id: string };
    await rejectRefund(id, parsed.data.reason);
    return { ok: true };
  });
}
