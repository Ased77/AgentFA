/** Pure window arithmetic for the rate limiter. No database imports, so this
    is safe (and cheap) to unit test. */

export type Limit = { windowSeconds: number; max: number };

/** Start of the fixed window containing `now` (epoch milliseconds). */
export function windowStart(now: number, windowSeconds: number): number {
  const size = windowSeconds * 1000;
  return Math.floor(now / size) * size;
}

/** Whole seconds until the window containing `now` rolls over. */
export function retryAfter(now: number, windowSeconds: number): number {
  const size = windowSeconds * 1000;
  return Math.max(1, Math.ceil((windowStart(now, windowSeconds) + size - now) / 1000));
}
