import { env } from "../env.js";
import { postForm } from "./http.js";
import { headerValue, verifyStripeSignature } from "./signature.js";
import {
  PaymentError,
  type CallbackOutcome,
  type CallbackPayload,
  type CallbackReference,
  type PaymentGateway,
  type PaymentIntent,
  type PaymentStart,
} from "./types.js";

/**
 * Stripe adapter.
 *
 *   1. POST /v1/checkout/sessions (form encoded) → { id, url }
 *   2. redirect the browser to `url` (Stripe hosts the payment page)
 *   3. Stripe POSTs `checkout.session.completed` to our webhook, signed with
 *      `Stripe-Signature`; the signature is verified against the raw body
 *      before anything is credited.
 *
 * Amounts are Stripe's minor units (cents for `STRIPE_CURRENCY`), which is why
 * the transaction records the currency the gateway charged in.
 */

/** Events that mean "money received". */
const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
/** Events that mean "this attempt is over and no money moved". */
const FAILED_EVENTS = new Set([
  "checkout.session.expired",
  "checkout.session.async_payment_failed",
  "payment_intent.payment_failed",
]);

function apiBase(): string {
  return (env.STRIPE_BASE_URL || "https://api.stripe.com").replace(/\/+$/, "");
}

function secretKey(): string {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new PaymentError("gateway_not_configured", "STRIPE_SECRET_KEY is not set", 503);
  return key;
}

/** Append/override query parameters without breaking an existing query string. */
function withParams(url: string, params: Record<string, string>): string {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}

type StripeEvent = {
  type?: string;
  data?: { object?: Record<string, unknown> };
};

export const stripeGateway: PaymentGateway = {
  id: "stripe",
  label: "Stripe",
  currency: env.STRIPE_CURRENCY.toUpperCase(),

  async start(intent: PaymentIntent): Promise<PaymentStart> {
    const form = new URLSearchParams({
      mode: "payment",
      success_url: withParams(intent.returnUrl, { status: "ok" }),
      cancel_url: withParams(intent.returnUrl, { status: "canceled" }),
      client_reference_id: intent.transactionId,
      "metadata[transaction_id]": intent.transactionId,
      "metadata[order_id]": intent.orderId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": intent.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(intent.amount),
      "line_items[0][price_data][product_data][name]": intent.description,
    });

    const { status, body } = await postForm(`${apiBase()}/v1/checkout/sessions`, form, {
      headers: { Authorization: `Bearer ${secretKey()}` },
    });

    const session = body as { id?: unknown; url?: unknown } | null;
    if (status >= 400 || typeof session?.url !== "string" || typeof session?.id !== "string") {
      throw new PaymentError("gateway_rejected", "Stripe rejected the checkout request", 502, body);
    }

    return { redirectUrl: session.url, providerToken: session.id };
  },

  referenceFromCallback(payload: CallbackPayload): CallbackReference | null {
    const event = payload.body as StripeEvent | null;
    const object = event?.data?.object ?? {};
    const metadata = (object.metadata ?? {}) as Record<string, unknown>;

    // A Stripe redirect (`?session_id=...`) is a status hint, not a payment:
    // the webhook is the only thing that settles. Prefer our own id when the
    // event carries it, otherwise look the session up by provider token.
    const transactionId = typeof metadata.transaction_id === "string" ? metadata.transaction_id : null;
    if (transactionId) return { kind: "transactionId", value: transactionId };

    const sessionId = typeof object.id === "string" ? object.id : payload.query.get("session_id");
    return sessionId ? { kind: "providerToken", value: sessionId } : null;
  },

  async verify(input: CallbackPayload & { transaction: { id: string } }): Promise<CallbackOutcome> {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new PaymentError("gateway_not_configured", "STRIPE_WEBHOOK_SECRET is not set", 503);
    }

    const check = verifyStripeSignature({
      header: headerValue(input.headers["stripe-signature"]),
      rawBody: input.rawBody,
      secret,
    });
    if (!check.ok) {
      throw new PaymentError("invalid_signature", `stripe signature rejected: ${check.reason}`, 400);
    }

    const event = (input.body ?? {}) as StripeEvent;
    const object = event.data?.object ?? {};
    const type = event.type ?? "";
    const providerToken = typeof object.id === "string" ? object.id : "";

    if (PAID_EVENTS.has(type)) {
      const paymentIntent = typeof object.payment_intent === "string" ? object.payment_intent : null;
      return {
        status: "paid",
        providerToken,
        // Stripe's charge/payment-intent id is the reference the payer sees.
        refId: paymentIntent ?? providerToken,
        raw: event,
      };
    }
    if (FAILED_EVENTS.has(type)) {
      return { status: "failed", providerToken, reason: type, raw: event };
    }
    return { status: "ignored", reason: type || "unknown_event", raw: event };
  },
};
