/** The 7-day money-back window, kept dependency-free so it can be unit tested
    without a database. `refunds.ts` re-exports these. */

export const REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function refundWindowOpen(purchasedAt: Date, now = Date.now()): boolean {
  return now - purchasedAt.getTime() <= REFUND_WINDOW_MS;
}
