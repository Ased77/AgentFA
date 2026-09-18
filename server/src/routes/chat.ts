import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { ownsAgent } from "../entitlements.js";
import { forbidden, notFound, tooMany } from "../lib/errors.js";
import { rateLimit } from "../redis.js";
import { findAgent } from "../provider/catalog.js";
import { activeProvider, providerCoversAgent } from "../provider/config.js";
import { loadPersona } from "../provider/persona.js";
import { agentSystemPrompt, HISTORY_LIMIT, ProviderFailure, streamChat } from "../provider/stream.js";
import { debitUsage, remaining } from "../wallet.js";

const input = z.object({
  agentId: z.string().min(1).max(200),
  message: z.string().trim().min(1).max(20_000),
  lang: z.enum(["fa", "en"]).default("fa"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(HISTORY_LIMIT)
    .default([]),
});

function sse(reply: any, event: string, payload: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/stream", async (req, reply) => {
    await app.requireUser(req, reply);
    const parsed = input.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_chat" });

    const { agentId, message, history, lang } = parsed.data;
    const userId = req.sessionUser!.id;
    if (!(await ownsAgent(userId, agentId))) throw forbidden("not_owned");

    const [agent, config, wallet] = await Promise.all([
      Promise.resolve(findAgent(agentId)),
      activeProvider(),
      prisma.wallet.findUnique({ where: { userId } }),
    ]);
    if (!agent) throw notFound("agent_not_found");
    if (!config) throw notFound("no_provider");
    if (!wallet) throw notFound("wallet_missing");
    if (!providerCoversAgent(config, agentId)) throw forbidden("not_covered");

    const rate = await rateLimit(`chat:${userId}`, [
      { windowSeconds: 60, max: 20 },
      { windowSeconds: 3600, max: 100 },
      { windowSeconds: 86400, max: 500 },
    ]);
    if (!rate.ok) throw tooMany("rate_limited");

    const persona = loadPersona(agentId);
    if (!persona) throw notFound("persona_not_found");
    const budget = config.meter === "tokens"
      ? { tokens: remaining(wallet, "tokens"), seconds: Number.MAX_SAFE_INTEGER }
      : { tokens: Number.MAX_SAFE_INTEGER, seconds: remaining(wallet, "time") };
    if (budget.tokens <= 0 || budget.seconds <= 0) throw forbidden("balance");

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    try {
      const outcome = await streamChat({
        config,
        system: agentSystemPrompt({
          name: agent.name,
          description: agent.description,
          persona,
          lang,
        }),
        history,
        message,
        budget,
        onDelta: (chunk) => sse(reply, "delta", { chunk }),
      });

      const charged = await prisma.$transaction((tx) =>
        debitUsage(tx as any, {
          userId,
          agentId,
          meter: config.meter,
          tokens: outcome.tokens,
          seconds: outcome.seconds,
          estimated: outcome.estimated,
          providerModel: config.model,
        }),
      );
      sse(reply, "done", { ...outcome, charged, meter: config.meter });
    } catch (err) {
      const code = err instanceof ProviderFailure ? err.kind : (err as { code?: string }).code ?? "network";
      sse(reply, "error", { error: code });
    } finally {
      reply.raw.end();
    }
  });
}