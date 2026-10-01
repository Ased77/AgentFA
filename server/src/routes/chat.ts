import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { ownsAgent } from "../entitlements.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { enforceLimit } from "../lib/limiter.js";
import { findAgent } from "../provider/catalog.js";
import { activeProvider, providerCoversAgent } from "../provider/config.js";
import { loadPersona } from "../provider/persona.js";
import { agentSystemPrompt, HISTORY_LIMIT, ProviderFailure, streamChat } from "../provider/stream.js";
import { debitUsage, ensurePeriod, remaining } from "../wallet.js";

/** Replies a user gets for free on an agent they have not bought. */
export const PREVIEW_MESSAGES = 3;

const input = z.object({
  agentId: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(200).optional(),
  message: z.string().trim().min(1).max(20_000),
  lang: z.enum(["fa", "en"]).default("fa"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(HISTORY_LIMIT)
    .default([]),
});

/** A preview reply is free but not unbounded: cap what one turn may produce. */
const PREVIEW_BUDGET = { tokens: 4_000, seconds: 120 };

function titleFrom(message: string): string {
  const line = message.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

function sse(reply: any, event: string, payload: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    await app.requireUser(req, reply);
  });

  /**
   * How much of the free preview is left on an agent.
   *
   * The allowance lives server-side, so the composer has to ask for it: showing
   * "3 free messages left" from a client counter would be a lie after a reload or
   * on a second device.
   */
  app.get("/preview", async (req) => {
    const { agentId } = req.query as { agentId?: string };
    if (!agentId) throw badRequest("agent_required");
    const owned = await ownsAgent(req.sessionUser!.id, agentId);
    const record = await prisma.previewUsage.findUnique({
      where: { userId_agentId: { userId: req.sessionUser!.id, agentId } },
    });
    const used = record?.used ?? 0;
    return { owned, limit: PREVIEW_MESSAGES, used, remaining: Math.max(0, PREVIEW_MESSAGES - used) };
  });

  /** Conversations for one agent, newest first, for the chat sidebar. */
  app.get("/conversations", async (req) => {
    const { agentId } = req.query as { agentId?: string };
    const conversations = await prisma.conversation.findMany({
      where: { userId: req.sessionUser!.id, ...(agentId ? { agentId } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, agentId: true, title: true, totalTokens: true, createdAt: true, updatedAt: true },
    });
    return { conversations };
  });

  app.get("/conversations/:id", async (req) => {
    const { id } = req.params as { id: string };
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: req.sessionUser!.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) throw notFound("conversation_not_found");
    return { conversation };
  });

  app.post("/conversations", async (req) => {
    const { agentId } = z.object({ agentId: z.string().min(1).max(200) }).parse(req.body);
    const conversation = await prisma.conversation.create({
      data: { userId: req.sessionUser!.id, agentId },
    });
    return { conversation: { ...conversation, messages: [] } };
  });

  app.delete("/conversations/:id", async (req) => {
    const { id } = req.params as { id: string };
    const result = await prisma.conversation.deleteMany({
      where: { id, userId: req.sessionUser!.id },
    });
    if (result.count === 0) throw notFound("conversation_not_found");
    return { ok: true };
  });

  app.post("/stream", async (req, reply) => {
    const parsed = input.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_chat" });

    const { agentId, conversationId, message, history, lang } = parsed.data;
    const userId = req.sessionUser!.id;

    const owned = await ownsAgent(userId, agentId);
    const previewRecord = owned
      ? null
      : await prisma.previewUsage.findUnique({ where: { userId_agentId: { userId, agentId } } });
    const previewUsed = previewRecord?.used ?? 0;
    if (!owned && previewUsed >= PREVIEW_MESSAGES) throw forbidden("not_owned");
    const preview = !owned;

    const [agent, config, wallet] = await Promise.all([
      findAgent(agentId),
      activeProvider(),
      prisma.wallet.findUnique({ where: { userId } }),
    ]);
    if (!agent) throw notFound("agent_not_found");
    if (!config) throw notFound("no_provider");
    if (!wallet) throw notFound("wallet_missing");
    if (!providerCoversAgent(config, agentId)) throw forbidden("not_covered");

    await enforceLimit(`chat:${userId}`, [
      { windowSeconds: 60, max: 20 },
      { windowSeconds: 3600, max: 100 },
      { windowSeconds: 86400, max: 500 },
    ]);

    const persona = await loadPersona(agentId);
    if (!persona) throw notFound("persona_not_found");

    const rolled = await ensurePeriod(prisma, wallet);
    const budget = preview
      ? PREVIEW_BUDGET
      : config.meter === "tokens"
        ? { tokens: remaining(rolled, "tokens"), seconds: Number.MAX_SAFE_INTEGER }
        : { tokens: Number.MAX_SAFE_INTEGER, seconds: remaining(rolled, "time") };
    if (budget.tokens <= 0 || budget.seconds <= 0) throw forbidden("balance");

    // Resolve (or open) the conversation and build history from what was persisted,
    // so a reload continues the same thread instead of starting over.
    let conversation = conversationId
      ? await prisma.conversation.findFirst({ where: { id: conversationId, userId, agentId } })
      : null;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { userId, agentId, title: titleFrom(message) },
      });
    }
    const stored = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    });
    const turns = stored.length
      ? stored
          .reverse()
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      : history;
    await prisma.message.create({
      data: { conversationId: conversation.id, role: "user", content: message },
    });

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
        history: turns,
        message,
        budget,
        onDelta: (chunk) => sse(reply, "delta", { chunk }),
      });

      let charged = 0;
      if (!preview) {
        charged = await prisma.$transaction((tx) =>
          debitUsage(tx, {
            userId,
            agentId,
            meter: config.meter,
            tokens: outcome.tokens,
            seconds: outcome.seconds,
            estimated: outcome.estimated,
            providerModel: config.model,
          }),
        );
      } else {
        await prisma.previewUsage.upsert({
          where: { userId_agentId: { userId, agentId } },
          create: { userId, agentId, used: 1 },
          update: { used: { increment: 1 } },
        });
      }

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content: outcome.text,
          tokens: outcome.tokens,
          seconds: outcome.seconds,
          model: config.model,
        },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { totalTokens: { increment: outcome.tokens } },
      });

      sse(reply, "done", {
        ...outcome,
        charged,
        meter: config.meter,
        conversationId: conversation.id,
        preview,
        previewRemaining: preview ? Math.max(0, PREVIEW_MESSAGES - previewUsed - 1) : null,
      });
    } catch (err) {
      const code = err instanceof ProviderFailure ? err.kind : (err as { code?: string }).code ?? "network";
      sse(reply, "error", { error: code });
    } finally {
      reply.raw.end();
    }
  });
}