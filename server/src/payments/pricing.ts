/** Server-owned pricing.
 *
 * The client sends what it wants to buy (tokens/minutes/plan), never what it
 * costs — the amount charged is always computed here. `GET /api/pricing` exposes
 * this same list so the UI can never display an amount the server would not
 * charge: the displayed price and the charged price come from one place.
 */

export type TopUpRequest = { tokens: number; minutes: number };
export type BillingPeriod = "monthly" | "yearly";
export type PlanKey = "free" | "basic" | "pro";

const TOMAN_PER_TOKEN_PAIR = 1 / 2; // 2 tokens per Toman
const TOMAN_PER_MINUTE = 500;

/** Yearly billing discount, applied by the server (never trusted from the client). */
export const YEARLY_DISCOUNT = 0.2;

/** Price in Toman for a top-up request. */
export function topUpPrice(input: TopUpRequest): number {
  return Math.round(input.tokens * TOMAN_PER_TOKEN_PAIR) + input.minutes * TOMAN_PER_MINUTE;
}

/** Human-readable line item for the gateway invoice. */
export function topUpDescription(input: TopUpRequest): string {
  const parts: string[] = [];
  if (input.tokens > 0) parts.push(`${input.tokens} tokens`);
  if (input.minutes > 0) parts.push(`${input.minutes} minutes`);
  return `AgentFA wallet top-up: ${parts.join(" + ")}`;
}

/** Sellable token bundles. Prices are derived from `topUpPrice`, so a bundle's
    advertised price and the amount charged can never drift apart. */
export const TOKEN_BUNDLES = [100_000, 300_000, 1_000_000] as const;

/** Sellable time passes, in minutes. Priced the same way as token bundles. */
export const TIME_PASSES = [60, 300, 1_200] as const;

export type PlanDefinition = {
  key: PlanKey;
  /** Monthly allowance granted by the plan. */
  tokens: number;
  minutes: number;
  /** Price for one billing period at the monthly rate. */
  monthlyPrice: number;
  featured?: boolean;
};

/** The plans the product actually sells. `free` costs nothing and is the default
    wallet state; switching to it charges nothing. */
export const PLANS: readonly PlanDefinition[] = [
  { key: "free", tokens: 50_000, minutes: 60, monthlyPrice: 0 },
  { key: "basic", tokens: 500_000, minutes: 600, monthlyPrice: 290_000, featured: true },
  { key: "pro", tokens: 2_000_000, minutes: 2_400, monthlyPrice: 990_000 },
];

export function findPlan(key: string): PlanDefinition | null {
  return PLANS.find((plan) => plan.key === key) ?? null;
}

/**
 * The amount charged for one period of `key`.
 *
 * Monthly is the list price; yearly is 12 discounted months charged up front, so
 * the number the UI shows is exactly the number the gateway is asked to take.
 */
export function planPrice(key: PlanKey, billing: BillingPeriod): number {
  const plan = findPlan(key);
  if (!plan) throw new Error(`unknown plan: ${key}`);
  if (plan.monthlyPrice === 0) return 0;
  const monthly = billing === "yearly" ? plan.monthlyPrice * (1 - YEARLY_DISCOUNT) : plan.monthlyPrice;
  const months = billing === "yearly" ? 12 : 1;
  return Math.round(monthly * months);
}

/** The monthly-equivalent price, for the "x / mo, billed yearly" sub-label. */
export function planMonthlyEquivalent(key: PlanKey, billing: BillingPeriod): number {
  const plan = findPlan(key);
  if (!plan) throw new Error(`unknown plan: ${key}`);
  return billing === "yearly" ? Math.round(plan.monthlyPrice * (1 - YEARLY_DISCOUNT)) : plan.monthlyPrice;
}

export function planDescription(key: PlanKey, billing: BillingPeriod): string {
  return `AgentFA ${key} plan (${billing})`;
}

/** The public price list served to the SPA. Numeric only: labels live in i18n. */
export function priceList() {
  return {
    currency: "IRT",
    yearlyDiscount: YEARLY_DISCOUNT,
    bundles: TOKEN_BUNDLES.map((tokens) => ({
      tokens,
      price: topUpPrice({ tokens, minutes: 0 }),
    })),
    timePasses: TIME_PASSES.map((minutes) => ({
      minutes,
      price: topUpPrice({ tokens: 0, minutes }),
    })),
    plans: PLANS.map((plan) => ({
      ...plan,
      monthlyEquivalent: Math.round(plan.monthlyPrice * (1 - YEARLY_DISCOUNT)),
    })),
  };
}

export type PriceList = ReturnType<typeof priceList>;
