import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publicWallet } from "../wallet.js";
import { badRequest } from "../lib/errors.js";

const topUpInput = z.object({
  tokens: z.coerce.number().int().min(0).max(10_000_000),
  minutes: z.coerce.number().int().min(0).max(100_000),
}).refine((input) => input.tokens > 0 || input.minutes > 0, "tokens or minutes is required");

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    await app.requireUser(req, reply);
  });

  app.get("/", async (req) => {
    const userId = req.sessionUser!.id;
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw badRequest("wallet_missing");
    return publicWallet(wallet);
  });

  /** Creates a pending transaction. A real payment callback is the only place
      that may credit the wallet; this route never credits a user itself. */
  app.post("/topup", async (req) => {
    const input = topUpInput.safeParse(req.body);
    if (!input.success) throw badRequest("invalid_topup", input.error.issues);
    const userId = req.sessionUser!.id;
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type: "topup",
        tokens: input.data.tokens,
        minutes: input.data.minutes,
        // Pricing is server-owned. Replace these rates when a gateway is selected.
        amount: Math.round(input.data.tokens / 2) + input.data.minutes * 500,
        provider: process.env.PAYMENT_PROVIDER ?? "none",
      },
    });
    return {
      transactionId: transaction.id,
      redirectUrl: `/payment-required?transaction=${transaction.id}`,
    };
  });
}