import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

/**
 * Vercel Function entry point for the whole API.
 *
 * The SPA and this function ship as one Vercel project, so the browser only
 * ever talks to its own origin: first-party cookies, no CORS, and the existing
 * static deploy keeps working. The Fastify instance is created once per warm
 * instance (Fluid compute) and reused across invocations.
 */
const holder = globalThis as unknown as { __agentfaApp?: Promise<FastifyInstance> };

async function getApp(): Promise<FastifyInstance> {
  const existing = holder.__agentfaApp;
  if (existing) return existing;

  const boot = (async () => {
    // Imported at request time: the compiled server is a separate ESM package.
    const { buildApp } = await import("../server/dist/app.js");
    const instance = await buildApp();
    await instance.ready();
    return instance;
  })();

  holder.__agentfaApp = boot;
  boot.catch(() => {
    // Never cache a failed boot: the next invocation may succeed.
    holder.__agentfaApp = undefined;
  });
  return boot;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const instance = await getApp();
  // Hand the raw Node request/response to Fastify rather than adding a proxy
  // layer, so the SSE frames written by the chat route reach the client as they
  // are produced.
  instance.server.emit("request", req, res);
}
