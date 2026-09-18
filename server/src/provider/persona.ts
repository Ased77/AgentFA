import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..", "..");
const contentDir = join(serverRoot, "content", "personas");

const cache = new Map<string, string | null>();

/** Full, untruncated persona body for an agent, read from server/content.
    Never shipped to the browser for an unowned agent. */
export function loadPersona(agentId: string): string | null {
  if (cache.has(agentId)) return cache.get(agentId) ?? null;
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;
  const file = join(contentDir, `${safe}.md`);
  const value = existsSync(file) ? readFileSync(file, "utf8").trim() : null;
  cache.set(agentId, value);
  return value;
}