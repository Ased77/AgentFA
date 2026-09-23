import { prisma } from "../db.js";
import {
  AGENT_SELECT,
  divisionCounts,
  toCatalogDivision,
  type CatalogAgent,
  type CatalogFile,
} from "./catalog-map.js";

/** Warm instances reuse the catalog for a short window instead of querying it
    on every request. `clearCatalogCache()` is available to tooling and tests. */
const CACHE_TTL_MS = 30_000;
let cache: { value: CatalogFile; expiresAt: number } | null = null;

export type { CatalogAgent, CatalogDivision, CatalogFile } from "./catalog-map.js";

export function clearCatalogCache(): void {
  cache = null;
}

/** Server-side source of truth for prices and agent identity. The data is
    seeded into Postgres by `src/seed-content.ts`; nothing is read from disk at
    runtime, so the same code works on a serverless platform. */
export async function loadCatalog(): Promise<CatalogFile> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const [agents, divisions, grouped] = await Promise.all([
    prisma.agent.findMany({
      select: AGENT_SELECT,
      orderBy: [{ division: "asc" }, { name: "asc" }],
    }),
    prisma.division.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.agent.groupBy({ by: ["division"], _count: { _all: true } }),
  ]);

  const counts = divisionCounts(grouped);
  const value: CatalogFile = {
    agents,
    divisions: divisions.map((row) => toCatalogDivision(row, counts.get(row.slug) ?? 0)),
  };
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function findAgent(id: string): Promise<CatalogAgent | null> {
  const { agents } = await loadCatalog();
  const hit = agents.find((agent) => agent.id === id);
  if (hit) return hit;
  // Not in the cache yet (e.g. added since it was filled): read through.
  return prisma.agent.findUnique({ where: { id }, select: AGENT_SELECT });
}