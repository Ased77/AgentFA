import { describe, expect, it } from "vitest";
import { callbackUrlFor, newOrderId, returnUrlFor } from "../src/payments/checkout.js";
import { topUpDescription, topUpPrice } from "../src/payments/pricing.js";
import { constantTimeEqualHex, hmacHex, verifyStripeSignature } from "../src/payments/signature.js";
import { isVerifiedCode, toRial, verifyFailureReason } from "../src/payments/zarinpal.js";

const SECRET = "whsec_test_secret";
const NOW = 1_790_000_000;

function sign(body: string, timestamp = NOW, secret = SECRET): string {
  return `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${body}`)}`;
}

describe("verifyStripeSignature", () => {
  const body = JSON.stringify({ type: "checkout.session.completed", id: "evt_1" });

  it("accepts a correctly signed body", () => {
    const result = verifyStripeSignature({ header: sign(body), rawBody: body, secret: SECRET, now: NOW });
    expect(result.ok).toBe(true);
  });

  it("rejects a body that was changed after signing", () => {
    const tampered = JSON.stringify({ type: "checkout.session.completed", id: "evt_2" });
    const result = verifyStripeSignature({ header: sign(body), rawBody: tampered, secret: SECRET, now: NOW });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a signature made with another secret", () => {
    const header = sign(body, NOW, "whsec_other");
    const result = verifyStripeSignature({ header, rawBody: body, secret: SECRET, now: NOW });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a replayed signature outside the tolerance window", () => {
    const header = sign(body, NOW - 3600);
    const result = verifyStripeSignature({ header, rawBody: body, secret: SECRET, now: NOW });
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("rejects missing, malformed and empty signatures", () => {
    expect(verifyStripeSignature({ header: undefined, rawBody: body, secret: SECRET }).ok).toBe(false);
    expect(verifyStripeSignature({ header: "v1=abc", rawBody: body, secret: SECRET }).ok).toBe(false);
    expect(verifyStripeSignature({ header: `t=${NOW},v1=`, rawBody: body, secret: SECRET, now: NOW }).ok).toBe(
      false,
    );
  });

  it("accepts any of several v1 signatures (secret rotation)", () => {
    const header = `t=${NOW},v1=${hmacHex("whsec_old", `${NOW}.${body}`)},v1=${hmacHex(SECRET, `${NOW}.${body}`)}`;
    expect(verifyStripeSignature({ header, rawBody: body, secret: SECRET, now: NOW }).ok).toBe(true);
  });
});

describe("constantTimeEqualHex", () => {
  it("compares digests and survives length differences", () => {
    expect(constantTimeEqualHex("abcd", "abcd")).toBe(true);
    expect(constantTimeEqualHex("abcd", "abce")).toBe(false);
    expect(constantTimeEqualHex("abcd", "abcde")).toBe(false);
  });
});

describe("zarinpal helpers", () => {
  it("converts Toman prices to the Rial amounts the gateway expects", () => {
    expect(toRial(49000)).toBe(490000);
    expect(toRial(0.5)).toBe(5);
  });

  it("treats 100 and 101 as verified and everything else as not", () => {
    expect(isVerifiedCode(100)).toBe(true);
    expect(isVerifiedCode(101)).toBe(true);
    expect(isVerifiedCode(-21)).toBe(false);
    expect(isVerifiedCode(undefined)).toBe(false);
  });

  it("names known failure codes and keeps unknown ones loggable", () => {
    expect(verifyFailureReason(-33, [])).toBe("amount_mismatch");
    expect(verifyFailureReason(-21, [])).toBe("no_transaction");
    expect(verifyFailureReason(-99, [])).toBe("gateway_-99");
    expect(verifyFailureReason(-30, { message: "Merchant is not valid" })).toBe(
      "gateway_-30:Merchant is not valid",
    );
  });
});

describe("top-up pricing (server-owned)", () => {
  it("prices tokens and minutes", () => {
    expect(topUpPrice({ tokens: 100_000, minutes: 0 })).toBe(50000);
    expect(topUpPrice({ tokens: 0, minutes: 60 })).toBe(30000);
    expect(topUpPrice({ tokens: 1000, minutes: 10 })).toBe(5500);
  });

  it("describes the purchase for the gateway invoice", () => {
    expect(topUpDescription({ tokens: 5000, minutes: 0 })).toContain("5000 tokens");
    expect(topUpDescription({ tokens: 0, minutes: 15 })).toContain("15 minutes");
  });
});

describe("checkout URLs", () => {
  it("builds order ids that are readable and unique", () => {
    const first = newOrderId(new Date("2026-09-23T10:00:00Z"));
    const second = newOrderId(new Date("2026-09-23T10:00:00Z"));
    expect(first).toMatch(/^AF-20260923-[0-9A-F]{8}$/);
    expect(first).not.toBe(second);
  });

  it("returns the payer to the SPA with the transaction and status", () => {
    expect(returnUrlFor("tx_1", "ok")).toBe(
      "http://localhost:8443/payment-required?transaction=tx_1&status=ok",
    );
    expect(returnUrlFor(undefined, "failed", "payer_canceled")).toBe(
      "http://localhost:8443/payment-required?status=failed&reason=payer_canceled",
    );
  });

  it("points the gateway callback at this API", () => {
    expect(callbackUrlFor("zarinpal")).toBe("http://localhost:8787/api/payments/callback/zarinpal");
  });
});
