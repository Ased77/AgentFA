/**
 * Wallet + entitlement store (localStorage).
 *
 * Two meters, because the custom provider profile picks one:
 *   tokens — debits `tokenBalance` by tokens consumed
 *   time   — debits `timeBalanceSeconds` by wall-clock seconds spent streaming
 *
 * Time is stored in seconds and displayed in minutes. Legacy wallets (v1,
 * tokens only) migrate in place on read, on the same storage key, so existing
 * balances survive the upgrade. Payments are still simulated — see
 * `plans/custom-provider-agents-only.md`.
 *
 * Ownership of agents lives here too: "agents only" means a provider call can
 * only ever happen for an agent this wallet has bought.
 */

export type MeterMode = "tokens" | "time";
export type PlanKey = "free" | "basic" | "pro";

export type Transaction = {
  id: string;
  type: "topup" | "purchase";
  tokens: number;
  minutes?: number;
  status: "success" | "failed";
  createdAt: string;
};

export type Wallet = {
  version: 2;
  tokenBalance: number;
  monthlyTokenLimit: number;
  monthlyUsage: number;
  /** Time meter — billed in seconds, displayed in minutes. */
  timeBalanceSeconds: number;
  monthlyTimeLimitSeconds: number;
  monthlyTimeUsedSeconds: number;
  plan: PlanKey;
  requests: number[];
  transactions: Transaction[];
};

/** Monthly allowance per plan, in both meters. */
export const PLAN_ALLOWANCE: Record<PlanKey, { tokens: number; minutes: number }> = {
  free: { tokens: 50000, minutes: 60 },
  basic: { tokens: 500000, minutes: 600 },
  pro: { tokens: 2000000, minutes: 2400 },
};

/** A message always costs at least this much on the time meter. */
export const MIN_TIME_CHARGE_SECONDS = 60;

const key = "agentfa-wallet";
const boughtKey = "agentfa-bought";

const base = (): Wallet => ({
  version: 2,
  tokenBalance: PLAN_ALLOWANCE.free.tokens,
  monthlyTokenLimit: PLAN_ALLOWANCE.free.tokens,
  monthlyUsage: 0,
  timeBalanceSeconds: PLAN_ALLOWANCE.free.minutes * 60,
  monthlyTimeLimitSeconds: PLAN_ALLOWANCE.free.minutes * 60,
  monthlyTimeUsedSeconds: 0,
  plan: "free",
  requests: [],
  transactions: [],
});

const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** v1 → v2: keep every balance, derive the missing time fields from the plan. */
function migrate(raw: unknown): Wallet {
  const stored = (raw ?? {}) as Partial<Wallet>;
  const plan: PlanKey =
    stored.plan === "basic" || stored.plan === "pro" ? stored.plan : "free";
  const fallback = base();
  const monthlyTokenLimit = num(stored.monthlyTokenLimit, fallback.monthlyTokenLimit);
  return {
    version: 2,
    tokenBalance: num(stored.tokenBalance, fallback.tokenBalance),
    monthlyTokenLimit,
    monthlyUsage: num(stored.monthlyUsage, 0),
    timeBalanceSeconds: num(
      stored.timeBalanceSeconds,
      PLAN_ALLOWANCE[plan].minutes * 60,
    ),
    monthlyTimeLimitSeconds: num(
      stored.monthlyTimeLimitSeconds,
      PLAN_ALLOWANCE[plan].minutes * 60,
    ),
    monthlyTimeUsedSeconds: num(stored.monthlyTimeUsedSeconds, 0),
    plan,
    requests: Array.isArray(stored.requests)
      ? stored.requests.filter((t): t is number => typeof t === "number")
      : [],
    transactions: Array.isArray(stored.transactions) ? stored.transactions : [],
  };
}

export const getWallet = (): Wallet => {
  try {
    return migrate(JSON.parse(localStorage.getItem(key) || "{}"));
  } catch {
    return base();
  }
};

const save = (wallet: Wallet) => localStorage.setItem(key, JSON.stringify(wallet));

export type SendCheck = { ok: boolean; code?: "rate" | "balance" };

/** Rate limits are shared by both meters; the allowance check is per meter. */
export function canSend(meter: MeterMode, need: number): SendCheck {
  const w = getWallet();
  const now = Date.now();
  const requests = w.requests.filter((t) => now - t < 86400000);
  const minute = requests.filter((t) => now - t < 60000).length;
  const hour = requests.filter((t) => now - t < 3600000).length;
  if (minute >= 20 || hour >= 100 || requests.length >= 500) return { ok: false, code: "rate" };
  if (meter === "time") {
    if (
      w.timeBalanceSeconds < need ||
      w.monthlyTimeUsedSeconds + need > w.monthlyTimeLimitSeconds
    )
      return { ok: false, code: "balance" };
    return { ok: true };
  }
  if (w.tokenBalance < need || w.monthlyUsage + need > w.monthlyTokenLimit)
    return { ok: false, code: "balance" };
  return { ok: true };
}

/** Debit a finished call and stamp the request (rate-limit window). */
export function recordUsage(meter: MeterMode, amount: number): Wallet {
  const w = getWallet();
  if (meter === "time") {
    w.timeBalanceSeconds = Math.max(0, w.timeBalanceSeconds - amount);
    w.monthlyTimeUsedSeconds += amount;
  } else {
    w.tokenBalance = Math.max(0, w.tokenBalance - amount);
    w.monthlyUsage += amount;
  }
  w.requests = [...w.requests.filter((t) => Date.now() - t < 86400000), Date.now()];
  save(w);
  return w;
}

/** Simulated top-up. Tokens by default; pass minutes for a time pass. */
export function topUp(tokens: number, minutes = 0): Wallet {
  const w = getWallet();
  if (tokens) w.tokenBalance += tokens;
  if (minutes) {
    w.timeBalanceSeconds += minutes * 60;
    w.monthlyTimeLimitSeconds += minutes * 60;
  }
  w.transactions.unshift({
    id: crypto.randomUUID(),
    type: "topup",
    tokens,
    minutes: minutes || undefined,
    status: "success",
    createdAt: new Date().toISOString(),
  });
  save(w);
  return w;
}

/** Switch plan: sets both monthly allowances and floors the balances at them. */
export function choosePlan(plan: PlanKey, tokens: number, minutes: number): Wallet {
  const w = getWallet();
  w.plan = plan;
  w.monthlyTokenLimit = tokens;
  w.monthlyTimeLimitSeconds = minutes * 60;
  w.tokenBalance = Math.max(w.tokenBalance, tokens);
  w.timeBalanceSeconds = Math.max(w.timeBalanceSeconds, minutes * 60);
  w.transactions.unshift({
    id: crypto.randomUUID(),
    type: "purchase",
    tokens,
    minutes,
    status: "success",
    createdAt: new Date().toISOString(),
  });
  save(w);
  return w;
}

// ---------------------------------------------------------------- ownership
// "Agents only": these gate every provider call.

/** Agent ids this browser has purchased. */
export const ownedAgents = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(boughtKey) || "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

export const ownsAgent = (id: string): boolean => ownedAgents().includes(id);

/** Record a purchase (simulated checkout) and return the owned set. */
export function ownAgent(id: string): string[] {
  const next = [...new Set([...ownedAgents(), id])];
  localStorage.setItem(boughtKey, JSON.stringify(next));
  return next;
}
