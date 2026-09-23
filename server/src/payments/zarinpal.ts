import { env } from "../env.js";
import { postJson } from "./http.js";
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
 * Zarinpal Payment Gateway v4.
 *
 *   1. POST /pg/v4/payment/request.json  → { data: { authority } }
 *   2. redirect the browser to           → {host}/pg/StartPay/{authority}
 *   3. Zarinpal redirects back to our callback_url with `Authority` and `Status`
 *   4. POST /pg/v4/payment/verify.json   → { data: { code: 100 | 101, ref_id } }
 *
 * Two details worth knowing:
 *  - amounts are in **Rial**; our prices are Toman, so the adapter multiplies by 10.
 *  - `Status=OK` on the redirect is only a hint. The verify call — which repeats
 *    the authority *and* the amount — is the authentication step. A callback is
 *    never credited without it.
 *
 * If your PSP's docs differ (different field names, a terminal id, a signature
 * scheme), only this file needs editing.
 */

const PRODUCTION_HOST = "https://payment.zarinpal.com";
const SANDBOX_HOST = "https://sandbox.zarinpal.com";

function host(): string {
  if (env.ZARINPAL_BASE_URL) return env.ZARINPAL_BASE_URL.replace(/\/+$/, "");
  return env.ZARINPAL_SANDBOX ? SANDBOX_HOST : PRODUCTION_HOST;
}

/** Our prices are Toman; Zarinpal charges in Rial. */
export function toRial(toman: number): number {
  return Math.round(toman * 10);
}

/** 100 = verified now, 101 = already verified by an earlier call. */
export function isVerifiedCode(code: unknown): boolean {
  return code === 100 || code === 101;
}

/** Map Zarinpal's error envelope onto a short, loggable reason. */
export function verifyFailureReason(code: unknown, errors: unknown): string {
  const codeText = typeof code === "number" || typeof code === "string" ? String(code) : "unknown";
  const known: Record<string, string> = {
    "-9": "validation_error",
    "-10": "merchant_not_found",
    "-11": "merchant_inactive",
    "-21": "no_transaction",
    "-22": "transaction_failed",
    "-33": "amount_mismatch",
    "-54": "invalid_authority",
  };
  const knownReason = known[codeText];
  if (knownReason) return knownReason;
  const message =
    errors && typeof errors === "object" && "message" in errors
      ? String((errors as { message?: unknown }).message)
      : "";
  return message ? `gateway_${codeText}:${message.slice(0, 120)}` : `gateway_${codeText}`;
}

/** The verify endpoint repeats the amount, so a tampered price cannot pass. */
export async function verifyPayment(input: {
  merchantId: string;
  amount: number;
  authority: string;
}): Promise<{ ok: boolean; code: unknown; refId: string | null; reason: string; raw: unknown }> {
  const { status, body } = await postJson(`${host()}/pg/v4/payment/verify.json`, {
    merchant_id: input.merchantId,
    amount: toRial(input.amount),
    authority: input.authority,
  });
  const data = (body as { data?: { code?: unknown; ref_id?: unknown } } | null)?.data ?? {};
  const errors = (body as { errors?: unknown } | null)?.errors;
  const code = data.code;

  if (status >= 400 || !isVerifiedCode(code)) {
    return { ok: false, code, refId: null, reason: verifyFailureReason(code, errors), raw: body };
  }
  return { ok: true, code, refId: data.ref_id == null ? null : String(data.ref_id), reason: "ok", raw: body };
}

export const zarinpalGateway: PaymentGateway = {
  id: "zarinpal",
  label: "Zarinpal",
  currency: "IRT",

  async start(intent: PaymentIntent): Promise<PaymentStart> {
    const merchantId = env.ZARINPAL_MERCHANT_ID;
    if (!merchantId) {
      throw new PaymentError("gateway_not_configured", "ZARINPAL_MERCHANT_ID is not set", 503);
    }

    const { status, body } = await postJson(`${host()}/pg/v4/payment/request.json`, {
      merchant_id: merchantId,
      amount: toRial(intent.amount),
      callback_url: intent.callbackUrl,
      description: intent.description,
      metadata: {
        order_id: intent.orderId,
        // Carried through the gateway so the callback can be traced even if a
        // server loses its provider token.
        transaction_id: intent.transactionId,
      },
    });

    const authority = (body as { data?: { authority?: unknown } } | null)?.data?.authority;
    if (status >= 400 || typeof authority !== "string" || authority.length === 0) {
      throw new PaymentError(
        "gateway_rejected",
        "Zarinpal rejected the payment request",
        502,
        body,
      );
    }

    return {
      redirectUrl: `${host()}/pg/StartPay/${authority}`,
      providerToken: authority,
    };
  },

  referenceFromCallback(payload: CallbackPayload): CallbackReference | null {
    const authority = payload.query.get("Authority") ?? payload.query.get("authority");
    return authority ? { kind: "providerToken", value: authority } : null;
  },

  async verify(input: CallbackPayload & { transaction: { providerToken: string | null; amount: number } }): Promise<CallbackOutcome> {
    const merchantId = env.ZARINPAL_MERCHANT_ID;
    if (!merchantId) {
      throw new PaymentError("gateway_not_configured", "ZARINPAL_MERCHANT_ID is not set", 503);
    }

    const authority = input.query.get("Authority") ?? input.query.get("authority") ?? "";
    if (!authority || authority !== input.transaction.providerToken) {
      throw new PaymentError(
        "invalid_callback",
        "callback authority does not match the pending transaction",
        400,
      );
    }

    // The payer (or their bank) cancelled: record it, credit nothing.
    const status = (input.query.get("Status") ?? input.query.get("status") ?? "").toUpperCase();
    if (status !== "OK") {
      return {
        status: "failed",
        providerToken: authority,
        reason: status === "NOK" ? "payer_canceled" : "gateway_status_missing",
        raw: Object.fromEntries(input.query),
      };
    }

    const verified = await verifyPayment({ merchantId, amount: input.transaction.amount, authority });
    if (!verified.ok || !verified.refId) {
      return {
        status: "failed",
        providerToken: authority,
        reason: verified.reason,
        raw: verified.raw,
      };
    }
    return { status: "paid", providerToken: authority, refId: verified.refId, raw: verified.raw };
  },
};
