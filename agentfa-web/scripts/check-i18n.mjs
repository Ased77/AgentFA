// Guards against translation drift.
//
// A key that exists in only one dictionary renders as its raw name in the other
// language (this is how `payment.pending` leaked into the English UI). Run via
// `bun run check:i18n`, or as part of `bun run check`.
//
// Three things are checked, because two of them have shipped bugs that key parity
// alone could not see:
//   1. the two dictionaries hold the same keys,
//   2. every `t("literal")` in the app resolves to a key that exists,
//   3. no component stores rendered text in state (`setError(t(...))`), which
//      freezes a message in the language that was showing when it failed.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

/** Every .ts/.tsx file under src, excluding nothing: a leaked key can be anywhere. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const dictionary = new Map([...fa, ...en].map((key) => [key, true]));
const unknownKeys = [];
const storedText = [];
const templatePrefixes = [];

for (const file of sourceFiles(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const text = readFileSync(file, "utf8");
  const relative = file.split(/[\\/]/).slice(-3).join("/");

  for (const match of text.matchAll(/(?<![\w.])t\(\s*"([^"]+)"/g)) {
    if (!dictionary.has(match[1])) unknownKeys.push(`${relative}: t("${match[1]}")`);
  }

  // `t(`auth.error.${code}`)` cannot be resolved statically, so its static prefix
  // has to match at least one real key instead.
  for (const match of text.matchAll(/(?<![\w.])t\(`([^`$]*)\$\{/g)) {
    const prefix = match[1];
    if (prefix && ![...dictionary.keys()].some((key) => key.startsWith(prefix))) {
      templatePrefixes.push(`${relative}: t(\`${prefix}…\`)`);
    }
  }

  for (const match of text.matchAll(/set(?:Error|Notice)\(\s*t\(/g)) {
    const line = text.slice(0, match.index).split("\n").length;
    storedText.push(`${relative}:${line}`);
  }
}

const failures = [
  { list: unknownKeys, message: "keys used in the app that exist in neither dictionary" },
  { list: templatePrefixes, message: "dynamic keys whose prefix matches no key" },
  { list: storedText, message: "rendered text stored in state (store the key instead)" },
].filter((entry) => entry.list.length > 0);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${failure.list.length} ${failure.message}:`);
    for (const item of failure.list.slice(0, 10)) console.error(`  ${item}`);
    console.error("");
  }
  process.exit(1);
}

console.log(`i18n OK — ${fa.size} keys in both dictionaries, all usages resolved.`);
