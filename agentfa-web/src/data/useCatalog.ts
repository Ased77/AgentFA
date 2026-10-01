import { useEffect, useState } from "react";
import type { Agent, CatalogDivision } from "./agents";

/**
 * The agent catalog, loaded on demand.
 *
 * `catalog.generated.ts` holds 264 agents with every description, feature bullet
 * and greeting — roughly 300 kB of the bundle. Importing it at module scope put
 * all of that in the entry chunk, so the marketing page downloaded the entire
 * catalog before it could paint a hero and six cards. Only the marketplace,
 * detail and dashboard routes actually need all of it, so they wait for this
 * hook instead; the landing page uses the small generated `featuredAgents` list.
 *
 * The import is cached at module scope, so the chunk is fetched once and every
 * later caller resolves from memory — including a second visit to the
 * marketplace in the same session.
 */
export type LoadedCatalog = {
  agents: Agent[];
  divisions: CatalogDivision[];
};

let cached: LoadedCatalog | null = null;
let pending: Promise<LoadedCatalog> | null = null;

function load(): Promise<LoadedCatalog> {
  if (cached) return Promise.resolve(cached);
  pending ??= import("./agents").then((module) => {
    cached = { agents: module.agents, divisions: module.divisions };
    return cached;
  });
  return pending;
}

/** `null` until the catalog is in memory: the caller decides what to render. */
export function useCatalog(): LoadedCatalog | null {
  const [catalog, setCatalog] = useState<LoadedCatalog | null>(cached);

  useEffect(() => {
    if (cached) {
      setCatalog(cached);
      return;
    }
    let live = true;
    void load().then((loaded) => {
      if (live) setCatalog(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  return catalog;
}
