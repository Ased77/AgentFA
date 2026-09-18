import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { ownedAgentIds, ownsAgent } from "../entitlements.js";
import { findAgent } from "../provider/catalog.js";
import { loadPersona } from "../provider/persona.js";

export async function agentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    await app.requireUser(req, reply);
  });

  app.get("/owned", async (req) => ({ owned: await ownedAgentIds(req.sessionUser!.id) }));

  app.get("/:agentId/persona", async (req) => {
    const { agentId } = req.params as { agentId: string };
    const userId = req.sessionUser!.id;
    if (!(await ownsAgent(userId, agentId))) throw forbidden("not_owned");
    const persona = loadPersona(agentId);
    if (!persona) throw notFound("persona_not_found");
    return { agentId, persona };
  });

  /** Creates a pending purchase. Provider webhook verification is the only path
      that creates an Entitlement, so editing browser storage cannot unlock it. */
  app.post("/:agentId/buy", async (req) => {
    const { agentId } = req.params as { agentId: string };
    const agent = findAgent(agentId);
    if (!agent) throw notFound("agent_not_found");
    const userId = req.sessionUser!.id;
    if (await ownsAgent(userId, agentId)) throw badRequest("already_owned");

    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type: "purchase",
        agentId,
        amount: agent.price,
        provider: process.env.PAYMENT_PROVIDER ?? "none",
      },
    });
    return {
      transactionId: transaction.id,
      price: agent.price,
      redirectUrl: `/payment-required?transaction=${transaction.id}`,
    };
  });
}