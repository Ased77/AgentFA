import type { MeterMode, Prisma, Wallet } from "@prisma/client";
import { paymentRequired } from "./lib/errors.js";

export const MIN_TIME_CHARGE_SECONDS = 60;

/** How long one allowance period lasts. */
export const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

type WalletClient = {
  wallet: {
    findUnique: (args: { where: { userId: string } }) => Promise<Wallet | null>;
    update: (args: { where: { userId: string }; data: Prisma.WalletUpdateInput }) => Promise<Wallet>;
  };
};

/** True once the current period has elapsed. */
export function periodRolled(periodStart: Date, now = Date.now()): boolean {
  return now - periodStart.getTime() >= PERIOD_MS;
}

/**
 * Roll the allowance period when it has elapsed: clear the usage counters and
 * refill the balance up to the plan allowance, keeping anything bought on top.
 * Returns the wallet as it stands now, rolled or not.
 *
 * Rolling lazily on read (rather than via a cron) keeps the serverless deploy
 * working with no scheduler configured.
 */
export async function ensurePeriod(
  client: WalletClient,
  wallet: Wallet,
  now = new Date(),
): Promise<Wallet> {
  if (!periodRolled(wallet.periodStart, now.getTime())) return wallet;

  return client.wallet.update({
    where: { userId: wallet.userId },
    data: {
      periodStart: now,
      monthlyUsage: 0,
      monthlyTimeUsedSeconds: 0,
      tokenBalance: Math.max(wallet.tokenBalance, wallet.monthlyTokenLimit),
      timeBalanceSeconds: Math.max(wallet.timeBalanceSeconds, wallet.monthlyTimeLimitSeconds),
    },
  });
}

/** Spendable balance for the configured meter. The balance is the only cap. */
export function remaining(wallet: Wallet, meter: MeterMode): number {
  return meter === "time" ? wallet.timeBalanceSeconds : wallet.tokenBalance;
}

export function assertAffordable(wallet: Wallet, meter: MeterMode, amount: number): void {
  if (remaining(wallet, meter) < amount) throw paymentRequired("balance");
}

export async function debitUsage(
  tx: Prisma.TransactionClient,
  input: { userId: string; agentId: string; meter: MeterMode; tokens: number; seconds: number; estimated: boolean; providerModel: string },
) {
  const amount = input.meter === "time" ? Math.max(MIN_TIME_CHARGE_SECONDS, input.seconds) : input.tokens;
  const found = await tx.wallet.findUnique({ where: { userId: input.userId } });
  if (!found) throw paymentRequired("wallet_missing");
  const wallet = await ensurePeriod(tx as unknown as WalletClient, found);
  assertAffordable(wallet, input.meter, amount);

  const update = input.meter === "time"
    ? { timeBalanceSeconds: { decrement: amount }, monthlyTimeUsedSeconds: { increment: amount } }
    : { tokenBalance: { decrement: amount }, monthlyUsage: { increment: amount } };

  await tx.wallet.update({ where: { userId: input.userId }, data: update });
  await tx.usageEvent.create({
    data: {
      userId: input.userId,
      agentId: input.agentId,
      tokens: input.tokens,
      seconds: input.seconds,
      estimated: input.estimated,
      providerModel: input.providerModel,
    },
  });
  return amount;
}

export function publicWallet(wallet: Wallet) {
  return {
    plan: wallet.plan,
    tokenBalance: wallet.tokenBalance,
    timeBalanceSeconds: wallet.timeBalanceSeconds,
    monthlyTokenLimit: wallet.monthlyTokenLimit,
    monthlyTimeLimitSeconds: wallet.monthlyTimeLimitSeconds,
    monthlyUsage: wallet.monthlyUsage,
    monthlyTimeUsedSeconds: wallet.monthlyTimeUsedSeconds,
    periodStart: wallet.periodStart,
  };
}