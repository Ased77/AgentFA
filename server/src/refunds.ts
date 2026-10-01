import { prisma } from "./db.js";
import { badRequest, conflict, forbidden, notFound } from "./lib/errors.js";
import { gatewayById } from "./payments/index.js";
import { newOrderId } from "./payments/checkout.js";
import { REFUND_WINDOW_MS, refundWindowOpen } from "./lib/refund-window.js";

export { REFUND_WINDOW_MS, refundWindowOpen };

/**
 * The 7-day money-back promise, made real.
 *
 * A refund is a request plus an admin decision: the money can only move once a
 * person (or a gateway that supports programmatic refunds) settles it, and the
 * entitlement is only revoked at that point. Requesting a refund therefore does
 * not silently lock the buyer out of something they may keep.
 */

/** Ask for a refund on an owned agent, within the window. */
export async function requestRefund(userId: string, agentId: string) {
  const entitlement = await prisma.entitlement.findFirst({
    where: { userId, agentId, revokedAt: null },
  });
  if (!entitlement) throw forbidden("not_owned");
  if (!refundWindowOpen(entitlement.purchasedAt)) throw badRequest("refund_window_closed");

  const open = await prisma.transaction.findFirst({
    where: { userId, agentId, type: "refund", status: { in: ["pending", "success"] } },
    select: { id: true },
  });
  if (open) throw conflict("refund_exists");

  const purchase = await prisma.transaction.findFirst({
    where: { userId, agentId, type: "purchase", status: "success" },
    orderBy: { paidAt: "desc" },
  });

  return prisma.transaction.create({
    data: {
      orderId: newOrderId(),
      userId,
      type: "refund",
      status: "pending",
      amount: entitlement.pricePaid,
      currency: purchase?.currency ?? "IRT",
      agentId,
      provider: purchase?.provider ?? null,
    },
  });
}

/**
 * Approve a refund: try the gateway, then revoke the entitlement and mark the
 * request settled. Idempotent — approving twice settles once.
 */
export async function approveRefund(refundId: string) {
  const refund = await prisma.transaction.findUnique({ where: { id: refundId } });
  if (!refund || refund.type !== "refund") throw notFound("refund_not_found");
  if (!refund.agentId) throw badRequest("agent_not_found");
  if (refund.status === "success") return { refund, settled: false };

  // Best-effort gateway refund. The local accounting stays correct even when the
  // gateway has to be settled by hand, which is why a failure is reported rather
  // than swallowed.
  let gatewayRef: string | null = null;
  const gateway = refund.provider ? gatewayById(refund.provider) : null;
  if (gateway?.refund) {
    const purchase = await prisma.transaction.findFirst({
      where: { userId: refund.userId, agentId: refund.agentId, type: "purchase", status: "success" },
      orderBy: { paidAt: "desc" },
    });
    if (purchase) {
      const outcome = await gateway.refund({
        transaction: {
          id: purchase.id,
          orderId: purchase.orderId,
          amount: purchase.amount,
          currency: purchase.currency,
          providerToken: purchase.providerToken,
          refId: purchase.refId,
        },
        amount: refund.amount,
      });
      if (!outcome.ok) throw badRequest(`gateway_refund_failed:${outcome.reason}`);
      gatewayRef = outcome.refId ?? null;
    }
  }

  const settled = await prisma.$transaction(async (tx) => {
    const current = await tx.transaction.findUnique({ where: { id: refund.id } });
    if (!current || current.status === "success") return false;
    await tx.entitlement.updateMany({
      where: { userId: refund.userId, agentId: refund.agentId!, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.transaction.update({
      where: { id: refund.id },
      data: { status: "success", paidAt: new Date(), refId: gatewayRef },
    });
    return true;
  });

  return { refund: { ...refund, status: "success" as const }, settled };
}

/** Reject a request and say why, so the buyer is not left guessing. */
export async function rejectRefund(refundId: string, reason: string) {
  const refund = await prisma.transaction.findUnique({ where: { id: refundId } });
  if (!refund || refund.type !== "refund") throw notFound("refund_not_found");
  if (refund.status === "success") throw conflict("refund_already_settled");

  await prisma.transaction.update({
    where: { id: refund.id },
    data: { status: "failed", failureReason: reason.slice(0, 200) },
  });
  return { ok: true as const };
}
