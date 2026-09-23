import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publicWallet } from "../wallet.js";
import { badRequest } from "../lib/errors.js";
import { startCheckout } from "../payments/checkout.js";
import { topUpDescription, topUpPrice } from "../payments/pricing.js";

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

  /**
   * Start a top-up: the price is computed here, a pending transaction is
   * created and the active gateway returns where to send the payer. This route
   * never credits anything — only a verified callback settles a transaction.
   */
  app.post("/topup", async (req) => {
    const input = topUpInput.safeParse(req.body);
    if (!input.success) throw badRequest("invalid_topup", input.error.issues);

    const checkout = await startCheckout({
      userId: req.sessionUser!.id,
      type: "topup",
      amount: topUpPrice(input.data),
      tokens: input.data.tokens,
      minutes: input.data.minutes,
      description: topUpDescription(input.data),
    });

    return {
      transactionId: checkout.transactionId,
      orderId: checkout.orderId,
      redirectUrl: checkout.redirectUrl,
      provider: checkout.provider,
    };
  });
}