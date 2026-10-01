import { prisma } from "./db.js";

export async function ownsAgent(userId: string, agentId: string): Promise<boolean> {
  return Boolean(
    await prisma.entitlement.findFirst({
      where: { userId, agentId, revokedAt: null },
      select: { id: true },
    }),
  );
}

/** Ids the user currently holds. A refunded purchase is not owned any more. */
export async function ownedAgentIds(userId: string): Promise<string[]> {
  const rows = await prisma.entitlement.findMany({
    where: { userId, revokedAt: null },
    select: { agentId: true },
    orderBy: { purchasedAt: "desc" },
  });
  return rows.map((row) => row.agentId);
}