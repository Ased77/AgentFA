import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..", "..");
const catalogFile = join(serverRoot, "content", "catalog.json");

export type CatalogAgent = {
  id: string;
  slug: string;
  icon: string;
  name: string;
  division: string;
  divisionLabel: string;
  category: string;
  price: number;
  description: string;
  longDescription: string;
  features: string[];
  prompts: string[];
  welcome: string;
};

export type CatalogDivision = {
  slug: string;
  label: string;
  labelFa: string;
  icon: string;
  color: string;
  count: number;
};

type CatalogFile = {
  agents: CatalogAgent[];
  divisions: CatalogDivision[];
};

let cache: CatalogFile | null = null;

/** Server-side source of truth for prices and agent identity. Written by
    `agentfa-web/scripts/export-personas.mjs`. */
export function loadCatalog(): CatalogFile {
  if (cache) return cache;
  if (!existsSync(catalogFile)) {
    cache = { agents: [], divisions: [] };
    return cache;
  }
  cache = JSON.parse(readFileSync(catalogFile, "utf8")) as CatalogFile;
  return cache;
}

export function findAgent(id: string): CatalogAgent | null {
  return loadCatalog().agents.find((a) => a.id === id) ?? null;
}