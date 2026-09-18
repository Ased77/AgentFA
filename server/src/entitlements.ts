import { prisma } from "./db.js";

export async function ownsAgent(userId: string, agentId: string): Promise<boolean> {
  return Boolean(
    await prisma.entitlement.findUnique({
      where: { userId_agentId: { userId, agentId } },
      select: { id: true },
    }),
  );
}

export async function ownedAgentIds(userId: string): Promise<string[]> {
  const rows = await prisma.entitlement.findMany({
    where: { userId },
    select: { agentId: true },
    orderBy: { purchasedAt: "desc" },
  });
  return rows.map((row) => row.agentId);
}