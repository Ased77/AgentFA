import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 as lowercase hex. */
export function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Length-safe constant-time comparison for hex digests. */
export function constantTimeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type SignatureCheck =
  | { ok: true; timestamp: number }
  | {
      ok: false;
      reason: "missing_signature" | "malformed" | "timestamp_out_of_tolerance" | "signature_mismatch";
    };

/**
 * Verify a Stripe-style `Stripe-Signature: t=<unix>,v1=<hex>` header:
 * HMAC-SHA256 over `${timestamp}.${rawBody}` with the endpoint secret.
 *
 * The raw (unparsed) body must be passed in: re-serialising the JSON would
 * change the bytes and invalidate every signature.
 * https://docs.stripe.com/webhooks#verify-manually
 */
export function verifyStripeSignature(input: {
  header: string | undefined;
  rawBody: string;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}): SignatureCheck {
  const { header, rawBody, secret, toleranceSeconds = 300, now = Math.floor(Date.now() / 1000) } = input;
  if (!header) return { ok: false, reason: "missing_signature" };

  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return { ok: false, reason: "malformed" };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now - seconds) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const expected = hmacHex(secret, `${timestamp}.${rawBody}`);
  if (!signatures.some((signature) => constantTimeEqualHex(signature, expected))) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true, timestamp: seconds };
}

/** Read a header that Fastify may hand over as a string or an array. */
export function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
