/** The payment contract.
 *
 * Adding a PSP means writing one adapter in this directory and registering it in
 * `./index.ts`. Routes, settlement, the database and the SPA only ever see these
 * types, so no other file needs to change. */

export type PaymentProviderId = "zarinpal" | "stripe";

export type PaymentFailureReason =
  | "gateway_not_configured"
  | "gateway_rejected"
  | "gateway_unreachable"
  | "invalid_callback"
  | "invalid_signature"
  | "transaction_not_found"
  | "payment_ref_mismatch"
  | "payment_ref_reused";

/** Anything a gateway rejects with. `status` is what the caller should return. */
export class PaymentError extends Error {
  constructor(
    readonly code: PaymentFailureReason,
    message: string,
    readonly status = 502,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

/** Parsed callback data. Redirect callbacks fill `query`, webhooks fill `body`. */
export type CallbackPayload = {
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  /** Unparsed body: required for signature verification. */
  rawBody: string;
};

/** Identifies the pending transaction a callback belongs to. */
export type CallbackReference = {
  kind: "providerToken" | "transactionId";
  value: string;
};

/** What the gateway needs to start a payment. Amounts are in minor units. */
export type PaymentIntent = {
  transactionId: string;
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  /** Absolute URL the payer's browser is sent back to when they finish. */
  returnUrl: string;
  /** Absolute URL the gateway calls to report the result. */
  callbackUrl: string;
};

export type PaymentStart = {
  /** Absolute URL the browser must be redirected to. */
  redirectUrl: string;
  /** Gateway handle we must store to verify the callback later. */
  providerToken: string;
};

/** The transaction as the gateway sees it: never trust the client's numbers. */
export type TransactionRef = {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  providerToken: string | null;
};

export type CallbackOutcome =
  | { status: "paid"; providerToken: string; refId: string; raw: unknown }
  | { status: "failed"; providerToken?: string; reason: string; raw: unknown }
  /** A signature-verified event that does not concern us (Stripe sends many). */
  | { status: "ignored"; reason: string; raw: unknown };

export type PaymentGateway = {
  id: PaymentProviderId;
  /** Shown in logs and stored on the transaction. */
  label: string;
  /** Currency the gateway charges in. Stored on the transaction at checkout. */
  currency: string;
  start(intent: PaymentIntent): Promise<PaymentStart>;
  /** Find which pending transaction a callback refers to. */
  referenceFromCallback(payload: CallbackPayload): CallbackReference | null;
  /**
   * Authenticate the callback and report the outcome.
   *
   * This is the only place a payment becomes real: a browser-supplied
   * "Status=OK" is never sufficient — the gateway itself must confirm both the
   * token and the amount before `settleTransaction` is allowed to credit.
   */
  verify(input: CallbackPayload & { transaction: TransactionRef }): Promise<CallbackOutcome>;
};
