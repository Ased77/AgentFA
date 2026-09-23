import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { findAgent } from "../provider/catalog.js";
import { badRequest, notFound } from "../lib/errors.js";

/**
 * Production payment gateways must verify their own signed callback before
 * calling `settleTransaction`. The endpoint remains deliberately unavailable
 * while PAYMENT_PROVIDER=none; there is no client-side or unauthenticated
 * credit path.
 */
export async function settleTransaction(transactionId: string, providerRef: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.transaction.findUnique({ where: { id: transactionId } });
    if (!row) throw notFound("transaction_not_found");
    if (row.status === "success") return;
    if (row.providerRef && row.providerRef !== providerRef) throw badRequest("payment_ref_mismatch");

    await tx.transaction.update({
      where: { id: row.id },
      data: { status: "success", providerRef },
    });

    if (row.type === "purchase") {
      if (!row.agentId || !(await findAgent(row.agentId))) throw badRequest("agent_not_found");
      await tx.entitlement.upsert({
        where: { userId_agentId: { userId: row.userId, agentId: row.agentId } },
        create: { userId: row.userId, agentId: row.agentId, pricePaid: row.amount },
        update: {},
      });
      return;
    }

    await tx.wallet.update({
      where: { userId: row.userId },
      data: {
        tokenBalance: { increment: row.tokens },
        timeBalanceSeconds: { increment: row.minutes * 60 },
        monthlyTimeLimitSeconds: { increment: row.minutes * 60 },
      },
    });
  });
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/webhook", async (_req, reply) => {
    // No generic successful webhook: accepting one here would be a payment bypass.
    return reply.status(501).send({ error: "payment_gateway_not_configured" });
  });
}