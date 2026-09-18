import type { MeterMode, Prisma, Wallet } from "@prisma/client";
import { paymentRequired } from "./lib/errors.js";

export const MIN_TIME_CHARGE_SECONDS = 60;

export function remaining(wallet: Wallet, meter: MeterMode): number {
  return meter === "time"
    ? Math.max(0, Math.min(wallet.timeBalanceSeconds, wallet.monthlyTimeLimitSeconds - wallet.monthlyTimeUsedSeconds))
    : Math.max(0, Math.min(wallet.tokenBalance, wallet.monthlyTokenLimit - wallet.monthlyUsage));
}

export function assertAffordable(wallet: Wallet, meter: MeterMode, amount: number): void {
  if (remaining(wallet, meter) < amount) throw paymentRequired("balance");
}

export async function debitUsage(
  tx: Prisma.TransactionClient,
  input: { userId: string; agentId: string; meter: MeterMode; tokens: number; seconds: number; estimated: boolean; providerModel: string },
) {
  const amount = input.meter === "time" ? Math.max(MIN_TIME_CHARGE_SECONDS, input.seconds) : input.tokens;
  const wallet = await (tx as any).wallet.findUnique({ where: { userId: input.userId } });
  if (!wallet) throw paymentRequired("wallet_missing");
  assertAffordable(wallet, input.meter, amount);

  const update = input.meter === "time"
    ? { timeBalanceSeconds: { decrement: amount }, monthlyTimeUsedSeconds: { increment: amount } }
    : { tokenBalance: { decrement: amount }, monthlyUsage: { increment: amount } };

  await (tx as any).wallet.update({ where: { userId: input.userId }, data: update });
  await (tx as any).usageEvent.create({
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
  };
}