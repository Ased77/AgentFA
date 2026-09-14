// Extract agent data from catalog.generated.ts (skips the type definitions above it).
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/data/catalog.generated.ts", import.meta.url),
  "utf8",
);
const start = src.indexOf("export const catalog");
const end = src.indexOf("export const divisions");
const json = src
  .slice(start, end)
  .replace(/^export const catalog: CatalogAgent\[\] =/, "")
  .trim()
  .replace(/;$/, "");
const agents = JSON.parse(json);

const out = agents.map((a) => ({
  id: a.id,
  division: a.division,
  name: a.name,
  description: a.description,
}));

writeFileSync(
  new URL("./catalog-agents-extract.json", import.meta.url),
  JSON.stringify(out, null, 2),
  "utf8",
);
console.log(`Extracted ${out.length} agents.`);
