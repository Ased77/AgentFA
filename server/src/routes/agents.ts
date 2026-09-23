import type { FastifyInstance } from "fastify";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { ownedAgentIds, ownsAgent } from "../entitlements.js";
import { startCheckout } from "../payments/checkout.js";
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
    const persona = await loadPersona(agentId);
    if (!persona) throw notFound("persona_not_found");
    return { agentId, persona };
  });

  /**
   * Start a purchase: the price is re-read from the catalog, a pending
   * transaction is created and the payer is sent to the gateway. Only a
   * verified payment callback creates the entitlement, so editing browser
   * storage cannot unlock anything.
   */
  app.post("/:agentId/buy", async (req) => {
    const { agentId } = req.params as { agentId: string };
    const agent = await findAgent(agentId);
    if (!agent) throw notFound("agent_not_found");
    const userId = req.sessionUser!.id;
    if (await ownsAgent(userId, agentId)) throw badRequest("already_owned");

    const checkout = await startCheckout({
      userId,
      type: "purchase",
      agentId,
      amount: agent.price,
      description: `AgentFA agent purchase: ${agent.name}`,
    });

    return {
      transactionId: checkout.transactionId,
      orderId: checkout.orderId,
      price: agent.price,
      redirectUrl: checkout.redirectUrl,
      provider: checkout.provider,
    };
  });
}