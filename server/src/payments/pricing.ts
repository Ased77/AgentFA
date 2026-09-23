/** Server-owned pricing for wallet top-ups.
 *
 * The client sends what it wants to buy (tokens/minutes), never what it costs —
 * the amount charged is always computed here. Replace the rates with a real
 * price list (or a per-currency table when Stripe is the active gateway). */

export type TopUpRequest = { tokens: number; minutes: number };

const TOMAN_PER_TOKEN_PAIR = 1 / 2; // 2 tokens per Toman
const TOMAN_PER_MINUTE = 500;

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
