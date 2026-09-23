/** Parsing and validation for the catalog seed produced by
    `agentfa-web/scripts/export-personas.mjs`. Kept free of database imports so
    it can be unit tested (and reused by tooling) without a Postgres instance. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SeedDivision = {
  slug: string;
  label: string;
  labelFa: string;
  icon: string;
  color: string;
  sortOrder: number;
};

export type SeedAgent = {
  id: string;
  slug: string;
  icon: string;
  name: string;
  category: string;
  division: string;
  divisionLabel: string;
  price: number;
  description: string;
  longDescription: string;
  features: string[];
  prompts: string[];
  welcome: string;
};

export type SeedFile = {
  generatedAt: string;
  divisions: SeedDivision[];
  agents: SeedAgent[];
  personas: Record<string, string>;
};

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");

/** `server/content/seed.json`, written during the build. */
export const seedFile = join(serverRoot, "content", "seed.json");

/** Validate the seed before it touches the database. */
export function parseSeed(raw: string): SeedFile {
  const parsed = JSON.parse(raw) as Partial<SeedFile>;
  if (!Array.isArray(parsed.agents) || !Array.isArray(parsed.divisions)) {
    throw new Error("seed.json must contain `agents` and `divisions` arrays");
  }
  for (const agent of parsed.agents) {
    if (!agent?.id || !agent.slug) {
      throw new Error("every seeded agent needs an id and a slug");
    }
  }

  const divisionSlugs = new Set(parsed.divisions.map((division) => division.slug));
  for (const agent of parsed.agents) {
    if (!divisionSlugs.has(agent.division)) {
      throw new Error(`agent ${agent.id} references unknown division ${agent.division}`);
    }
  }

  return {
    generatedAt: parsed.generatedAt ?? "",
    divisions: parsed.divisions,
    agents: parsed.agents,
    personas: parsed.personas ?? {},
  };
}
