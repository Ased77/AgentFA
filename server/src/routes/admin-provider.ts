import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { encryptSecret } from "../provider/crypto.js";
import { activeProvider, toPublic } from "../provider/config.js";
import { providerInput } from "../provider/validate.js";
import { streamChat } from "../provider/stream.js";

export async function adminProviderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    await app.requireAdmin(req, reply);
  });

  app.get("/provider", async (_req, reply) => {
    const config = await activeProvider();
    if (!config) return reply.send({ provider: null });
    return reply.send({ provider: toPublic(config) });
  });

  app.put("/provider", async (req, reply) => {
    const input = providerInput.parse(req.body);
    const existing = await activeProvider();

    const data = {
      label: input.label,
      baseUrl: input.baseUrl,
      apiKeyCipher: encryptSecret(input.apiKey),
      model: input.model,
      meter: input.meter,
      tomanPer1kTokens: input.tomanPer1kTokens,
      tomanPerMinute: input.tomanPerMinute,
      agentScope: input.agentScope,
      enabled: input.enabled,
    };

    const config = existing
      ? await prisma.providerConfig.update({ where: { id: existing.id }, data })
      : await prisma.providerConfig.create({ data });

    return reply.send({ provider: toPublic(config) });
  });

  app.delete("/provider", async (_req, reply) => {
    const existing = await activeProvider();
    if (existing) await prisma.providerConfig.delete({ where: { id: existing.id } });
    return reply.send({ ok: true });
  });

  app.post("/provider/test", async (_req, reply) => {
    const config = await activeProvider();
    if (!config) throw notFound("no_provider");
    try {
      const outcome = await streamChat({
        config,
        system:
          "You are a connectivity probe for the AgentFA platform. Reply with the single word: ok.",
        history: [],
        message: "Reply with the single word: ok.",
        onDelta: () => {},
      });
      return reply.send({ ok: true, tokens: outcome.tokens, seconds: outcome.seconds });
    } catch (err) {
      const kind = (err as { kind?: string }).kind ?? "network";
      return reply.status(502).send({ ok: false, error: kind });
    }
  });
}