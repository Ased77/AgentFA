import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { ensurePeriod, publicWallet } from "../wallet.js";
import { badRequest, notFound } from "../lib/errors.js";
import { startCheckout } from "../payments/checkout.js";
import { findPlan, planDescription, planPrice, topUpDescription, topUpPrice } from "../payments/pricing.js";

const topUpInput = z.object({
  tokens: z.coerce.number().int().min(0).max(10_000_000),
  minutes: z.coerce.number().int().min(0).max(100_000),
}).refine((input) => input.tokens > 0 || input.minutes > 0, "tokens or minutes is required");

const planInput = z.object({
  plan: z.enum(["free", "basic", "pro"]),
  billing: z.enum(["monthly", "yearly"]).default("monthly"),
});

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    await app.requireUser(req, reply);
  });

  app.get("/", async (req) => {
    const userId = req.sessionUser!.id;
    const found = await prisma.wallet.findUnique({ where: { userId } });
    if (!found) throw badRequest("wallet_missing");
    return publicWallet(await ensurePeriod(prisma, found));
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

  /**
   * Switch plans.
   *
   * The free plan costs nothing, so it is applied directly. A paid plan goes
   * through the same checkout as everything else: the amount is `planPrice()`
   * (the monthly list price, or twelve discounted months for yearly), never a
   * number the client sent, and the wallet only changes once the gateway settles
   * the transaction.
   */
  app.post("/plan", async (req) => {
    const input = planInput.safeParse(req.body);
    if (!input.success) throw badRequest("invalid_plan", input.error.issues);
    const plan = findPlan(input.data.plan);
    if (!plan) throw notFound("unknown_plan");
    const userId = req.sessionUser!.id;

    if (plan.monthlyPrice === 0) {
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) throw notFound("wallet_missing");
      const updated = await prisma.wallet.update({
        where: { userId },
        data: {
          plan: plan.key,
          monthlyTokenLimit: plan.tokens,
          monthlyTimeLimitSeconds: plan.minutes * 60,
          tokenBalance: Math.max(wallet.tokenBalance, plan.tokens),
          timeBalanceSeconds: Math.max(wallet.timeBalanceSeconds, plan.minutes * 60),
          monthlyUsage: 0,
          monthlyTimeUsedSeconds: 0,
          periodStart: new Date(),
        },
      });
      return { plan: updated.plan, redirectUrl: null, transactionId: null };
    }

    const checkout = await startCheckout({
      userId,
      type: "plan",
      plan: plan.key,
      billingPeriod: input.data.billing,
      amount: planPrice(plan.key, input.data.billing),
      description: planDescription(plan.key, input.data.billing),
    });

    return {
      transactionId: checkout.transactionId,
      orderId: checkout.orderId,
      redirectUrl: checkout.redirectUrl,
      provider: checkout.provider,
    };
  });

  /** Recent purchases, plan changes and top-ups, newest first. */
  app.get("/transactions", async (req) => {
    const transactions = await prisma.transaction.findMany({
      where: { userId: req.sessionUser!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        orderId: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        tokens: true,
        minutes: true,
        agentId: true,
        plan: true,
        billingPeriod: true,
        createdAt: true,
        paidAt: true,
        failureReason: true,
      },
    });
    return { transactions };
  });

  /** Daily token/second totals for the usage chart. */
  app.get("/usage", async (req) => {
    const raw = Number((req.query as { days?: string }).days);
    const days = Math.min(90, Math.max(1, Number.isFinite(raw) && raw > 0 ? raw : 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const events = await prisma.usageEvent.findMany({
      where: { userId: req.sessionUser!.id, createdAt: { gte: since } },
      select: { tokens: true, seconds: true, createdAt: true },
    });
    const buckets = new Map<string, { tokens: number; seconds: number }>();
    for (const event of events) {
      const day = event.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(day) ?? { tokens: 0, seconds: 0 };
      bucket.tokens += event.tokens;
      bucket.seconds += event.seconds;
      buckets.set(day, bucket);
    }
    return {
      days,
      points: [...buckets.entries()]
        .map(([day, totals]) => ({ day, ...totals }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  });
}