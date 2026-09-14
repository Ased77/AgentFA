// Generates src/data/catalog.generated.ts from the AgentFA corpus.
// Source of truth: /divisions.json + <division>/*.md (YAML-ish frontmatter).
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");

const divisions = JSON.parse(readFileSync(join(repoRoot, "divisions.json"), "utf8")).divisions;

const DEFAULT_ICON = "🤖";

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[m[1]] = value;
  }
  return { data, body: text.slice(match[0].length).trim() };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DIVISION_LABEL_FA = {
  academic: "دانشگاهی",
  design: "طراحی",
  engineering: "مهندسی",
  finance: "مالی",
  "game-development": "بازی‌سازی",
  gis: "سیستم اطلاعات جغرافیایی",
  healthcare: "سلامت",
  marketing: "مارکتینگ",
  "paid-media": "رسانه پرداختی",
  product: "محصول",
  "project-management": "مدیریت پروژه",
  research: "پژوهش",
  sales: "فروش",
  security: "امنیت",
  "spatial-computing": "رایانش فضایی",
  specialized: "تخصصی",
  support: "پشتیبانی",
  testing: "تست",
};

const PRICE_BY_DIVISION = {
  engineering: 49000,
  design: 39000,
  marketing: 29000,
  sales: 39000,
  finance: 59000,
  product: 49000,
  security: 69000,
  research: 49000,
  academic: 29000,
  healthcare: 69000,
  "game-development": 49000,
  gis: 59000,
  "paid-media": 39000,
  "project-management": 39000,
  "spatial-computing": 59000,
  specialized: 49000,
  support: 29000,
  testing: 39000,
};

function firstParagraph(body) {
  const stripped = body
    .replace(/^#.*$/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\*\*/g, "")
    .trim();
  const para = stripped.split(/\r?\n\r?\n/).find((p) => p.trim().length > 40);
  return (para ?? stripped).trim().slice(0, 400);
}

function bulletList(body, headingRe, limit) {
  const lines = body.split(/\r?\n/);
  const out = [];
  let active = false;
  for (const line of lines) {
    if (/^#{2,3}\s/.test(line)) {
      active = headingRe.test(line);
      continue;
    }
    if (!active) continue;
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (m) {
      const item = m[1].replace(/\*\*/g, "").trim();
      if (item && item.length < 120) out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// Persona cap — the system prompt shipped to a provider is the agent's own
// markdown body. Bodies average ~14KB; only the leading identity/mission
// sections matter for behaviour, so we cap hard and mark the truncation.
const PERSONA_CAP = 2400;

function capPersona(body) {
  const clean = body.replace(/\r\n/g, "\n").trim();
  if (clean.length <= PERSONA_CAP) return clean;
  return `${clean.slice(0, PERSONA_CAP).trimEnd()}\n\n[... truncated ...]`;
}

const agents = [];
const personas = {};
const usedIds = new Set();

for (const [slug, meta] of Object.entries(divisions)) {
  const dir = join(repoRoot, slug);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const raw = readFileSync(join(dir, file), "utf8");
    const { data, body } = parseFrontmatter(raw);
    const fileSlug = file.replace(/\.md$/, "");
    const name = data.name || fileSlug;
    const seed = hash(`${slug}/${fileSlug}`);
    const rating = Number((4 + (seed % 10) / 10).toFixed(1));
    const sales = 200 + (seed % 1800);
    const price = PRICE_BY_DIVISION[slug] ?? 39000;
    const features = bulletList(body, /(core mission|what you|capabilit|skill|responsibilit|feature)/i, 6);
    const prompts = bulletList(body, /(task|prompt|example|use case|when to)/i, 4);

    let id = fileSlug;
    let n = 2;
    while (usedIds.has(id)) id = `${fileSlug}-${n++}`;
    usedIds.add(id);

    // Keyed by agent id (the value the UI routes/chats with) so chat can look
    // up a persona straight from `/chat/:agentId`.
    personas[id] = capPersona(body);

    agents.push({
      id,
      slug: fileSlug,
      icon: data.emoji || DEFAULT_ICON,
      name,
      category: DIVISION_LABEL_FA[slug] || meta.label,
      division: slug,
      divisionLabel: meta.label,
      price,
      rating,
      sales,
      description: data.description || firstParagraph(body),
      longDescription: data.vibe || firstParagraph(body),
      features: features.length ? features : [data.description || name],
      prompts: prompts.length ? prompts : ["برای شروع یک درخواست بنویس"],
      welcome: `سلام! من ${name} هستم. ${data.vibe || "چطور می‌توانم کمکت کنم؟"}`,
      featured: seed % 7 === 0,
      color: data.color || null,
    });
  }
}

const divisionList = Object.entries(divisions).map(([slug, m]) => ({
  slug,
  label: m.label,
  labelFa: DIVISION_LABEL_FA[slug] || m.label,
  icon: m.icon,
  color: m.color,
  count: agents.filter((a) => a.division === slug).length,
}));

const banner = `// AUTO-GENERATED by scripts/generate-catalog.mjs — do not edit by hand.
// Source: /divisions.json + <division>/*.md frontmatter. Run: npm run catalog
`;

const personaBanner = `// AUTO-GENERATED by scripts/generate-catalog.mjs — do not edit by hand.
// Agent persona bodies (markdown, capped at ${PERSONA_CAP} chars) keyed by agent id.
// Loaded lazily by the chat page only — marketplace visitors never fetch it.
// Run: npm run catalog
`;

const personaOut = `${personaBanner}
export type CatalogPersona = string;

export const personas: Record<string, CatalogPersona> = ${JSON.stringify(personas, null, 2)};

export const personaCount = Object.keys(personas).length;
`;

writeFileSync(join(webRoot, "src", "data", "personas.generated.ts"), personaOut, "utf8");

const out = `${banner}
export type CatalogAgent = {
  id: string;
  slug: string;
  icon: string;
  name: string;
  category: string;
  division: string;
  divisionLabel: string;
  price: number;
  rating: number;
  sales: number;
  description: string;
  longDescription: string;
  features: string[];
  prompts: string[];
  welcome: string;
  featured?: boolean;
  color?: string | null;
};

export type CatalogDivision = {
  slug: string;
  label: string;
  labelFa: string;
  icon: string;
  color: string;
  count: number;
};

export const catalog: CatalogAgent[] = ${JSON.stringify(agents, null, 2)};

export const divisions: CatalogDivision[] = ${JSON.stringify(divisionList, null, 2)};

export const catalogCount = catalog.length;
`;

writeFileSync(join(webRoot, "src", "data", "catalog.generated.ts"), out, "utf8");
console.log(
  `Generated ${agents.length} agents across ${divisionList.length} divisions ` +
    `(${Object.keys(personas).length} personas, capped at ${PERSONA_CAP} chars).`,
);