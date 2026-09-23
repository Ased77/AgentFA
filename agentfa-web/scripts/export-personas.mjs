// Exports the catalog seed (public metadata + full private personas) that
// `server/src/seed-content.ts` loads into Postgres. The web bundle must never
// contain private persona bodies.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const serverContent = resolve(repoRoot, "server", "content");

const generated = readFileSync(join(webRoot, "src", "data", "catalog.generated.ts"), "utf8");
// EOL-agnostic: the generated files are checked out with CRLF on Windows.
const catalogMatch =
  /export const catalog: CatalogAgent\[\] = (\[[\s\S]*?\]);\r?\n\r?\nexport const divisions/.exec(generated);
const divisionsMatch =
  /export const divisions: CatalogDivision\[\] = (\[[\s\S]*?\]);\r?\n\r?\nexport const catalogCount/.exec(generated);
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
mkdirSync(serverContent, { recursive: true });

const personas = {};
for (const agent of catalog) {
  const persona = sourceBySlug.get(agent.slug);
  if (!persona) throw new Error(`Missing persona source for ${agent.id}`);
  personas[agent.id] = persona;
}

// One seed artifact for Postgres. The API never reads these files at runtime,
// so the same build works locally and inside a serverless function.
const seed = {
  generatedAt: new Date().toISOString(),
  divisions: divisions.map(({ count, ...division }, index) => ({ ...division, sortOrder: index })),
  agents: catalog.map(({ rating, sales, featured, color, ...agent }) => agent),
  personas,
};
writeFileSync(join(serverContent, "seed.json"), `${JSON.stringify(seed, null, 2)}\n`, "utf8");
console.log(
  `Exported ${seed.agents.length} agents, ${seed.divisions.length} divisions and ` +
    `${Object.keys(personas).length} personas to server/content/seed.json`,
);
