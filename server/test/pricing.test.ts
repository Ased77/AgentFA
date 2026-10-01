import { describe, expect, it } from "vitest";
import {
  PLANS,
  TIME_PASSES,
  TOKEN_BUNDLES,
  YEARLY_DISCOUNT,
  findPlan,
  planPrice,
  priceList,
  topUpPrice,
} from "../src/payments/pricing.js";
import { PERIOD_MS, periodRolled } from "../src/wallet.js";
import { REFUND_WINDOW_MS, refundWindowOpen } from "../src/lib/refund-window.js";

describe("price list", () => {
  it("prices every bundle by the same rule the charge uses", () => {
    for (const { tokens, price } of priceList().bundles) {
      expect(price).toBe(topUpPrice({ tokens, minutes: 0 }));
    }
    for (const { minutes, price } of priceList().timePasses) {
      expect(price).toBe(topUpPrice({ tokens: 0, minutes }));
    }
  });

  it("serves the sellable catalogue", () => {
    expect(priceList().bundles.map((b) => b.tokens)).toEqual([...TOKEN_BUNDLES]);
    expect(priceList().timePasses.map((p) => p.minutes)).toEqual([...TIME_PASSES]);
    expect(priceList().plans.map((p) => p.key)).toEqual(PLANS.map((p) => p.key));
  });
});

describe("plan pricing", () => {
  it("charges the monthly list price for a monthly period", () => {
    expect(planPrice("basic", "monthly")).toBe(290_000);
    expect(planPrice("pro", "monthly")).toBe(990_000);
  });

  it("charges twelve discounted months for a yearly period", () => {
    expect(planPrice("basic", "yearly")).toBe(Math.round(290_000 * (1 - YEARLY_DISCOUNT) * 12));
    expect(planPrice("pro", "yearly")).toBe(Math.round(990_000 * (1 - YEARLY_DISCOUNT) * 12));
  });

  it("makes the free plan free either way", () => {
    expect(planPrice("free", "monthly")).toBe(0);
    expect(planPrice("free", "yearly")).toBe(0);
  });

  it("rejects unknown plans", () => {
    expect(() => planPrice("enterprise" as never, "monthly")).toThrow();
    expect(findPlan("nope")).toBeNull();
  });
});

describe("allowance period", () => {
  it("does not roll before the period elapses", () => {
    const start = new Date(1_790_000_000_000);
    expect(periodRolled(start, start.getTime())).toBe(false);
    expect(periodRolled(start, start.getTime() + PERIOD_MS - 1)).toBe(false);
  });

  it("rolls once the period has elapsed", () => {
    const start = new Date(1_790_000_000_000);
    expect(periodRolled(start, start.getTime() + PERIOD_MS)).toBe(true);
  });
});

describe("refund window", () => {
  it("accepts a purchase inside seven days and refuses one after", () => {
    const purchased = new Date(1_790_000_000_000);
    expect(refundWindowOpen(purchased, purchased.getTime())).toBe(true);
    expect(refundWindowOpen(purchased, purchased.getTime() + REFUND_WINDOW_MS)).toBe(true);
    expect(refundWindowOpen(purchased, purchased.getTime() + REFUND_WINDOW_MS + 1)).toBe(false);
  });
});
