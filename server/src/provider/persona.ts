import { prisma } from "../db.js";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();

export function clearPersonaCache(): void {
  cache.clear();
}

/** Full, untruncated persona body for an agent, read from Postgres. Never
    shipped to the browser for an unowned agent. */
export async function loadPersona(agentId: string): Promise<string | null> {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;

  const hit = cache.get(safe);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const row = await prisma.persona.findUnique({
    where: { agentId: safe },
    select: { body: true },
  });
  const value = row?.body?.trim() || null;
  cache.set(safe, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}