import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";
import { enforceLimit } from "../lib/limiter.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { endSession, readSession, startSession } from "../lib/session.js";

const credentials = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/register",
    async (req, reply) => {
      const parsed = credentials.safeParse(req.body);
      if (!parsed.success) throw badRequest("invalid_credentials", parsed.error.issues);
      const { email, password } = parsed.data;
      await enforceLimit(`auth:register:${req.ip}`, [{ windowSeconds: 900, max: 10 }]);

      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) throw conflict("email_taken");

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(password),
          wallet: { create: {} },
        },
      });

      await startSession(reply, user.id);
      return reply.status(201).send({
        user: { id: user.id, email: user.email, role: user.role },
      });
    },
  );

  app.post(
    "/login",
    async (req, reply) => {
      const parsed = credentials.safeParse(req.body);
      if (!parsed.success) throw badRequest("invalid_credentials", parsed.error.issues);
      const { email, password } = parsed.data;
      await enforceLimit(`auth:login:ip:${req.ip}`, [{ windowSeconds: 900, max: 20 }]);
      await enforceLimit(`auth:login:email:${email.toLowerCase()}`, [
        { windowSeconds: 900, max: 10 },
      ]);

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) throw unauthorized("bad_login");
      if (!(await verifyPassword(user.passwordHash, password))) throw unauthorized("bad_login");

      await startSession(reply, user.id);
      return reply.send({ user: { id: user.id, email: user.email, role: user.role } });
    },
  );

  app.post("/logout", async (req, reply) => {
    await endSession(req, reply);
    return reply.send({ ok: true });
  });

  app.get("/me", async (req, reply) => {
    const user = await readSession(req);
    if (!user) return reply.status(401).send({ error: "unauthorized" });
    return reply.send({ user });
  });
}