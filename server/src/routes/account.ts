import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePhone, startChallenge, verifyChallenge, verificationError } from "../auth/otp.js";
import { prisma } from "../db.js";
import { badRequest, conflict } from "../lib/errors.js";
import { endSession } from "../lib/session.js";

/**
 * The signed-in user's own account.
 *
 * Phone-only identity has one obvious failure mode: lose the SIM and you lose
 * the account and everything bought with it. This route is the escape hatch —
 * a verified move to a new number keeps the same user id, so the wallet and every
 * entitlement survive the change.
 */

const phoneInput = z.object({ phone: z.string().min(1).max(32) });
const codeInput = z.object({ phone: z.string().min(1).max(32), code: z.string().min(1).max(12) });

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    await app.requireUser(req, reply);
  });

  app.get("/", async (req) => ({ user: req.sessionUser! }));

  /** Delete the account and everything that hangs off it (cascade). */
  app.delete("/", async (req, reply) => {
    const userId = req.sessionUser!.id;
    await endSession(req, reply);
    await prisma.user.delete({ where: { id: userId } });
    return reply.send({ ok: true });
  });

  /** Start an SMS challenge for the number the user wants to move to. */
  app.post("/phone/start", async (req) => {
    const parsed = phoneInput.safeParse(req.body);
    if (!parsed.success) throw badRequest("phone_required", parsed.error.issues);
    const phone = requirePhone(parsed.data.phone);
    if (phone === req.sessionUser!.phone) throw badRequest("phone_unchanged");

    const owner = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (owner && owner.id !== req.sessionUser!.id) throw conflict("phone_taken");

    const challenge = await startChallenge({
      phone,
      ip: req.ip,
      log: (line) => req.log.warn({ userId: req.sessionUser!.id, msg: line }),
    });

    return {
      phone: challenge.phone,
      expiresInSeconds: challenge.expiresInSeconds,
      resendInSeconds: challenge.resendInSeconds,
      ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
    };
  });

  /** Verify the code sent to the new number and move the account onto it. */
  app.post("/phone/verify", async (req) => {
    const parsed = codeInput.safeParse(req.body);
    if (!parsed.success) throw badRequest("code_required", parsed.error.issues);
    const phone = requirePhone(parsed.data.phone);

    const check = await verifyChallenge({
      phone,
      code: parsed.data.code,
      ip: req.ip,
      log: (line) => req.log.warn({ userId: req.sessionUser!.id, msg: line }),
    });
    if (!check.ok) throw verificationError(check.reason);

    try {
      const user = await prisma.user.update({
        where: { id: req.sessionUser!.id },
        data: { phone },
        select: { id: true, phone: true, role: true },
      });
      return { user };
    } catch {
      // A unique-constraint race: somebody claimed the number between the check
      // above and this write.
      throw conflict("phone_taken");
    }
  });
}
