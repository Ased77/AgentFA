// Exports public catalog data and full private personas for the API server.
// The web bundle must never contain private persona bodies.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const serverContent = resolve(repoRoot, "server", "content");
const personasDir = join(serverContent, "personas");

const generated = readFileSync(join(webRoot, "src", "data", "catalog.generated.ts"), "utf8");
const catalogMatch = /export const catalog: CatalogAgent\[\] = (\[[\s\S]*?\]);\n\nexport const divisions/.exec(generated);
const divisionsMatch = /export const divisions: CatalogDivision\[\] = (\[[\s\S]*?\]);\n\nexport const catalogCount/.exec(generated);
if (!catalogMatch || !divisionsMatch) throw new Error("Could not parse generated catalog data");
const catalog = JSON.parse(catalogMatch[1]);
const divisions = JSON.parse(divisionsMatch[1]);

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? text.slice(match[0].length).trim() : text.trim();
}

const sourceBySlug = new Map();
for (const division of Object.keys(JSON.parse(readFileSync(join(repoRoot, "divisions.json"), "utf8")).divisions)) {
  const dir = join(repoRoot, division);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
    sourceBySlug.set(file.replace(/\.md$/, ""), parseFrontmatter(readFileSync(join(dir, file), "utf8")));
  }
}

rmSync(serverContent, { recursive: true, force: true });
mkdirSync(personasDir, { recursive: true });

for (const agent of catalog) {
  const persona = sourceBySlug.get(agent.slug);
  if (!persona) throw new Error(`Missing persona source for ${agent.id}`);
  writeFileSync(join(personasDir, `${agent.id}.md`), persona, "utf8");
}

const publicCatalog = {
  agents: catalog.map(({ rating, sales, featured, color, ...agent }) => agent),
  divisions,
};
writeFileSync(join(serverContent, "catalog.json"), JSON.stringify(publicCatalog, null, 2), "utf8");
console.log(`Exported ${catalog.length} private personas and public catalog for the API server.`);
