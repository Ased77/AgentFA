import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { consumeChallenge, requirePhone, startChallenge, verificationError } from "../auth/otp.js";
import { prisma } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { endSession, readSession, startSession } from "../lib/session.js";

/**
 * Authentication is a phone number and an SMS code — there is no password to
 * forget, reset or leak, and `otp/verify` is the single place a session is born.
 *
 * `/otp/start` and `/otp/verify` replace the old `/register` and `/login`. A new
 * number and a known number take the same path, so the API never reveals whether
 * an account exists and a code request for a stranger's number changes nothing.
 */

const phoneInput = z.object({ phone: z.string().min(1).max(32) });
const codeInput = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(1).max(12),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Ask for a login code. Creates no user: the account appears when a code is
   * verified, which keeps this endpoint safe to expose to anyone.
   */
  app.post("/otp/start", async (req, reply) => {
    const parsed = phoneInput.safeParse(req.body);
    if (!parsed.success) throw badRequest("phone_required", parsed.error.issues);
    const phone = requirePhone(parsed.data.phone);

    const challenge = await startChallenge({
      phone,
      ip: req.ip,
      log: (line) => req.log.warn({ phone, msg: line }),
    });

    if (challenge.devCode) {
      // Development only, never production: with no provider configured the code
      // is echoed so the flow is usable without SMS credit.
      req.log.warn({ phone, msg: "returning devCode because SMS_PROVIDER=none" });
    }

    return reply.send({
      phone: challenge.phone,
      expiresInSeconds: challenge.expiresInSeconds,
      resendInSeconds: challenge.resendInSeconds,
      ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
    });
  });

  /** Verify the code: creates the account on first login and starts the session. */
  app.post("/otp/verify", async (req, reply) => {
    const parsed = codeInput.safeParse(req.body);
    if (!parsed.success) throw badRequest("code_required", parsed.error.issues);
    const phone = requirePhone(parsed.data.phone);

    const outcome = await consumeChallenge({
      phone,
      code: parsed.data.code,
      ip: req.ip,
      log: (line) => req.log.warn({ phone, msg: line }),
    });
    if (!outcome.ok) throw verificationError(outcome.reason);

    const user = await prisma.user.findUnique({ where: { id: outcome.userId } });
    await startSession(reply, outcome.userId);

    return reply.send({
      user: { id: outcome.userId, phone: user?.phone ?? phone, role: user?.role ?? "user" },
      isNewUser: outcome.isNewUser,
    });
  });

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
