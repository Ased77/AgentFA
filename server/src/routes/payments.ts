import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { returnUrlFor } from "../payments/checkout.js";
import { findPlan } from "../payments/pricing.js";
import { activeGateway, gatewayById, PaymentError } from "../payments/index.js";
import type {
  CallbackPayload,
  CallbackReference,
  PaymentGateway,
  TransactionRef,
} from "../payments/types.js";

/**
 * Settle a verified payment.
 *
 * Idempotent by design: a replayed callback returns `credited: false` instead
 * of crediting twice, and the gateway reference is unique across transactions,
 * so two orders can never share one payment.
 */
export async function settleTransaction(input: {
  transactionId: string;
  refId: string;
  providerToken?: string;
}): Promise<{ credited: boolean; status: "success" }> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.transaction.findUnique({ where: { id: input.transactionId } });
    if (!row) throw notFound("transaction_not_found");

    // Already settled: a duplicate callback/webhook is a no-op, not an error.
    if (row.status === "success") return { credited: false, status: "success" as const };

    if (row.refId && row.refId !== input.refId) throw badRequest("payment_ref_mismatch");
    const clash = await tx.transaction.findUnique({ where: { refId: input.refId } });
    if (clash && clash.id !== row.id) throw badRequest("payment_ref_reused");

    await tx.transaction.update({
      where: { id: row.id },
      data: {
        status: "success",
        refId: input.refId,
        providerToken: input.providerToken ?? row.providerToken,
        paidAt: new Date(),
        failureReason: null,
      },
    });

    if (row.type === "purchase") {
      if (!row.agentId) throw badRequest("agent_not_found");
      // A re-purchase after a refund clears `revokedAt` instead of leaving the
      // old revoked row in place (which would silently deny access).
      await tx.entitlement.upsert({
        where: { userId_agentId: { userId: row.userId, agentId: row.agentId } },
        create: { userId: row.userId, agentId: row.agentId, pricePaid: row.amount },
        update: { revokedAt: null, pricePaid: row.amount },
      });
      return { credited: true, status: "success" as const };
    }

    if (row.type === "plan") {
      const plan = row.plan ? findPlan(row.plan) : null;
      if (!plan) throw badRequest("unknown_plan");
      const wallet = await tx.wallet.findUnique({ where: { userId: row.userId } });
      if (!wallet) throw notFound("wallet_missing");
      // Buying a period sets the allowance the plan grants, refills up to it and
      // starts a fresh period. Anything bought on top is preserved.
      await tx.wallet.update({
        where: { userId: row.userId },
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
      return { credited: true, status: "success" as const };
    }

    if (row.type === "topup") {
      // Top-ups add spendable balance. They must not inflate the plan's monthly
      // allowance: that is what `plan` transactions are for.
      await tx.wallet.update({
        where: { userId: row.userId },
        data: {
          tokenBalance: { increment: row.tokens },
          timeBalanceSeconds: { increment: row.minutes * 60 },
        },
      });
      return { credited: true, status: "success" as const };
    }

    // A refund recorded as a transaction never credits anything.
    return { credited: false, status: "success" as const };
  });
}

/** Mark a pending transaction as failed. Never downgrades a settled one. */
export async function failTransaction(input: {
  transactionId: string;
  reason: string;
}): Promise<void> {
  await prisma.transaction.updateMany({
    where: { id: input.transactionId, status: "pending" },
    data: { status: "failed", failureReason: input.reason.slice(0, 200) },
  });
}

function gatewayFromParams(params: unknown): PaymentGateway {
  const { provider } = params as { provider?: string };
  const gateway = provider ? gatewayById(provider) : activeGateway();
  if (!gateway) throw notFound("unknown_provider");
  return gateway;
}

/** Redirect callbacks fill the query string, webhooks fill the body. */
function callbackPayload(req: FastifyRequest): CallbackPayload {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries((req.query ?? {}) as Record<string, unknown>)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return {
    query,
    body: req.body ?? null,
    headers: req.headers,
    rawBody: req.rawBody ?? "",
  };
}

function toRef(row: {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  providerToken: string | null;
}): TransactionRef {
  return {
    id: row.id,
    orderId: row.orderId,
    amount: row.amount,
    currency: row.currency,
    providerToken: row.providerToken,
  };
}

async function pendingTransaction(reference: CallbackReference) {
  return reference.kind === "providerToken"
    ? prisma.transaction.findUnique({ where: { providerToken: reference.value } })
    : prisma.transaction.findUnique({ where: { id: reference.value } });
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Browser-facing callback: the gateway redirects the payer back here.
   *
   * Always answers with a redirect, whatever happened — a payment that cannot
   * be verified is recorded as failed and never credited.
   */
  app.route({
    method: ["GET", "POST"],
    url: "/callback/:provider",
    handler: async (req, reply) => {
      const gateway = gatewayFromParams(req.params);
      const payload = callbackPayload(req);

      try {
        const reference = gateway.referenceFromCallback(payload);
        if (!reference) {
          throw new PaymentError("invalid_callback", "callback carries no reference", 400);
        }

        const pending = await pendingTransaction(reference);
        if (!pending) {
          req.log.warn({ provider: gateway.id }, "payment callback for an unknown transaction");
          return reply.redirect(returnUrlFor(undefined, "failed", "unknown_transaction"), 302);
        }

        const outcome = await gateway.verify({ ...payload, transaction: toRef(pending) });

        if (outcome.status === "paid") {
          const settled = await settleTransaction({
            transactionId: pending.id,
            refId: outcome.refId,
            providerToken: outcome.providerToken,
          });
          req.log.info(
            {
              provider: gateway.id,
              orderId: pending.orderId,
              transactionId: pending.id,
              refId: outcome.refId,
              amount: pending.amount,
              credited: settled.credited,
            },
            "payment settled from callback",
          );
          return reply.redirect(returnUrlFor(pending.id, "ok"), 302);
        }

        if (outcome.status === "failed") {
          await failTransaction({ transactionId: pending.id, reason: outcome.reason });
          req.log.warn(
            { provider: gateway.id, orderId: pending.orderId, reason: outcome.reason },
            "payment failed at the gateway",
          );
          return reply.redirect(returnUrlFor(pending.id, "failed", outcome.reason), 302);
        }

        return reply.redirect(returnUrlFor(pending.id), 302);
      } catch (error) {
        const code = error instanceof PaymentError ? error.code : "internal";
        req.log.error({ provider: gateway.id, err: error }, "payment callback could not be verified");
        return reply.redirect(returnUrlFor(undefined, "failed", code), 302);
      }
    },
  });

  /**
   * Server-to-server webhook (Stripe).
   *
   * Signed: the signature is verified against the raw body before the event is
   * read, and errors keep their HTTP status so the gateway can retry.
   */
  app.post("/webhook/:provider", async (req, reply) => {
    const gateway = gatewayFromParams(req.params);
    const payload = callbackPayload(req);
    const reference = gateway.referenceFromCallback(payload);
    if (!reference) throw badRequest("invalid_callback");

    const pending = await pendingTransaction(reference);
    if (!pending) throw notFound("transaction_not_found");

    const outcome = await gateway.verify({ ...payload, transaction: toRef(pending) });

    if (outcome.status === "paid") {
      const settled = await settleTransaction({
        transactionId: pending.id,
        refId: outcome.refId,
        providerToken: outcome.providerToken,
      });
      req.log.info(
        {
          provider: gateway.id,
          orderId: pending.orderId,
          transactionId: pending.id,
          refId: outcome.refId,
          credited: settled.credited,
        },
        "payment settled from webhook",
      );
      return reply.send({ ok: true, settled: settled.credited, orderId: pending.orderId });
    }

    if (outcome.status === "failed") {
      await failTransaction({ transactionId: pending.id, reason: outcome.reason });
      req.log.warn(
        { provider: gateway.id, orderId: pending.orderId, reason: outcome.reason },
        "payment failed",
      );
      return reply.send({ ok: true, settled: false, orderId: pending.orderId });
    }

    // Signature verified, but not an event that moves money.
    req.log.info({ provider: gateway.id, event: outcome.reason }, "ignoring unrelated webhook event");
    return reply.send({ ok: true, ignored: outcome.reason });
  });

  /** Status polling for the SPA after the payer returns from the gateway. */
  app.get("/:transactionId", async (req, reply) => {
    await app.requireUser(req, reply);
    const { transactionId } = req.params as { transactionId: string };
    const row = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!row || row.userId !== req.sessionUser!.id) throw notFound("transaction_not_found");

    return reply.send({
      transactionId: row.id,
      orderId: row.orderId,
      type: row.type,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      provider: row.provider,
      refId: row.refId,
      agentId: row.agentId,
      tokens: row.tokens,
      minutes: row.minutes,
      paidAt: row.paidAt,
      failureReason: row.failureReason,
      createdAt: row.createdAt,
    });
  });
}
