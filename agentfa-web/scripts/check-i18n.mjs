// Guards against translation drift.
//
// A key that exists in only one dictionary renders as its raw name in the other
// language (this is how `payment.pending` leaked into the English UI). Run via
// `bun run check:i18n`, or as part of `bun run check`.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/i18n.tsx", import.meta.url), "utf8");

function keysBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  const from = source.indexOf("{", start);
  const end = source.indexOf(endMarker, from);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  const body = source.slice(from, end);
  return new Set([...body.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));
}

const fa = keysBetween("const fa: Dict =", "const en: Dict =");
const en = keysBetween("const en: Dict =", "const dicts:");

const missingInEn = [...fa].filter((key) => !en.has(key)).sort();
const missingInFa = [...en].filter((key) => !fa.has(key)).sort();

if (missingInEn.length || missingInFa.length) {
  console.error("i18n dictionaries are out of sync:");
  for (const key of missingInEn) console.error(`  en is missing "${key}"`);
  for (const key of missingInFa) console.error(`  fa is missing "${key}"`);
  process.exit(1);
}

console.log(`i18n OK — ${fa.size} keys in both dictionaries.`);
