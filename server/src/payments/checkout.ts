import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { badRequest } from "../lib/errors.js";
import { requireGateway } from "./index.js";
import { PaymentError } from "./types.js";

export type CheckoutType = "topup" | "purchase";

export type CheckoutInput = {
  userId: string;
  type: CheckoutType;
  /** Amount in the gateway's minor unit, always computed server-side. */
  amount: number;
  tokens?: number;
  minutes?: number;
  agentId?: string;
  description: string;
};

export type Checkout = {
  transactionId: string;
  orderId: string;
  redirectUrl: string;
  provider: string;
};

/** `AF-20260923-9F3C21A4` — readable in bank statements and support tickets. */
export function newOrderId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `AF-${day}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** Where the payer's browser lands once the gateway is done with it. */
export function returnUrlFor(
  transactionId?: string,
  status?: "ok" | "failed" | "canceled",
  reason?: string,
): string {
  const url = new URL("/payment-required", env.PUBLIC_WEB_URL);
  if (transactionId) url.searchParams.set("transaction", transactionId);
  if (status) url.searchParams.set("status", status);
  if (reason) url.searchParams.set("reason", reason.slice(0, 120));
  return url.toString();
}

/** Where the gateway reports the result. Must be reachable from the internet. */
export function callbackUrlFor(provider: string): string {
  return new URL(`/api/payments/callback/${provider}`, env.PUBLIC_API_URL).toString();
}

/**
 * Create the pending transaction, then ask the gateway for a redirect URL.
 *
 * Two invariants:
 *  - the amount is decided by the caller from server-side data (agent price or
 *    the price list), never from the request body;
 *  - nothing is credited here. Only a verified callback may settle.
 */
export async function startCheckout(input: CheckoutInput): Promise<Checkout> {
  const gateway = requireGateway();
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw badRequest("invalid_amount");
  }

  const transaction = await prisma.transaction.create({
    data: {
      orderId: newOrderId(),
      userId: input.userId,
      type: input.type,
      status: "pending",
      amount: input.amount,
      currency: gateway.currency,
      tokens: input.tokens ?? 0,
      minutes: input.minutes ?? 0,
      agentId: input.agentId,
      provider: gateway.id,
    },
  });

  try {
    const started = await gateway.start({
      transactionId: transaction.id,
      orderId: transaction.orderId,
      amount: input.amount,
      currency: gateway.currency,
      description: input.description,
      returnUrl: returnUrlFor(transaction.id),
      callbackUrl: callbackUrlFor(gateway.id),
    });

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { providerToken: started.providerToken },
    });

    return {
      transactionId: transaction.id,
      orderId: transaction.orderId,
      redirectUrl: started.redirectUrl,
      provider: gateway.id,
    };
  } catch (error) {
    // Never leave a pending row that can never settle.
    await prisma.transaction
      .update({
        where: { id: transaction.id },
        data: {
          status: "failed",
          failureReason: error instanceof PaymentError ? error.code : "gateway_error",
        },
      })
      .catch(() => {});
    throw error;
  }
}
