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
  name: a.name,
  category: a.category,
  description: a.description,
  longDescription: a.longDescription,
  features: a.features,
  prompts: a.prompts,
}));

writeFileSync(
  new URL("./catalog-full-extract.json", import.meta.url),
  JSON.stringify(out, null, 1),
  "utf8",
);
console.log(`Extracted ${out.length} agents.`);
