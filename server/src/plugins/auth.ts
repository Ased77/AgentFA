import type { FastifyInstance } from "fastify";
import { readSession, type SessionUser } from "../lib/session.js";
import { forbidden, unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    sessionUser?: SessionUser | null;
    /** Unparsed request body, kept for gateway signature verification. */
    rawBody?: string;
  }
  interface FastifyInstance {
    requireUser: (req: unknown, reply: unknown) => Promise<void>;
    requireAdmin: (req: unknown, reply: unknown) => Promise<void>;
  }
}

export function registerAuthGuard(app: FastifyInstance): void {
  app.decorateRequest("sessionUser", null);

  app.decorate("requireUser", async (req: any, reply: any) => {
    const user = await readSession(req);
    if (!user) throw unauthorized();
    req.sessionUser = user;
  });

  app.decorate("requireAdmin", async (req: any, reply: any) => {
    const user = await readSession(req);
    if (!user) throw unauthorized();
    if (user.role !== "admin") throw forbidden("admin_only");
    req.sessionUser = user;
  });

  app.setErrorHandler((err, req, reply) => {
    const status = (err as any).status ?? 500;
    const code = (err as any).code ?? "internal";
    if (status >= 500) req.log.error({ err }, "unhandled error");
    reply.status(typeof status === "number" ? status : 500).send({
      error: typeof code === "string" ? code : "internal",
      detail: (err as any).detail ?? null,
    });
  });
}