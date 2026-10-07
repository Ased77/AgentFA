/**
 * One-off audit: are the `lengths` arrays in agentfa-web/src/lib/phone.ts right?
 *
 * Ground truth = the lengths a country's mobile *pattern* (libphonenumber
 * metadata.mobile.json) can actually realize, computed by parsing the pattern and
 * solving it for achievable lengths. `possible_lengths` in the metadata is a looser
 * superset, so a length-only validator built from it can accept junk.
 */
import { readFileSync } from "node:fs";
// Resolve the scratch-dir copy explicitly: libphonenumber is deliberately NOT a
// project dependency.
const plIndex = new URL(`file://${join(tmpdir(), "pl", "node_modules", "libphonenumber-js", "mobile", "index.js").replace(/\\/g, "/")}`);
const { parsePhoneNumberFromString } = await import(plIndex);
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plDir = join(tmpdir(), "pl", "node_modules", "libphonenumber-js");
const meta = JSON.parse(readFileSync(join(plDir, "metadata.mobile.json"), "utf8"));
const examples = JSON.parse(readFileSync(join(plDir, "mobile", "examples", "examples.mobile.json"), "utf8"));

// ---- the on-disk table, parsed straight from the source ----
const phoneSrc = readFileSync(join(root, "agentfa-web", "src", "lib", "phone.ts"), "utf8");
const onDisk = new Map();
for (const m of phoneSrc.matchAll(/\{ iso: "([A-Z]{2})", dial: "(\d+)", fa: "([^"]*)", en: "([^"]*)", trunk: "([^"]*)", lengths: \[([\d, ]+)\], example: "([^"]*)"/g)) {
  onDisk.set(m[1], { dial: m[2], trunk: m[5], lengths: m[6].split(",").map(Number), example: m[7] });
}
// The IRAN const is multi-line, so the one-line regex above misses it.
const iranBlock = phoneSrc.match(/export const IRAN:[^;]*?lengths: \[([\d, ]+)\],/s);
if (iranBlock) onDisk.set("IR", { dial: "98", trunk: "0", lengths: iranBlock[1].split(",").map(Number), example: "0912 345 6789" });

// ---- tiny regex solver for the metadata pattern subset ----
const CAP = 20;

function parsePattern(src) {
  let i = 0;
  function parseAlt() {
    const branches = [parseSeq()];
    while (src[i] === "|") { i++; branches.push(parseSeq()); }
    return branches.length === 1 ? branches[0] : { t: "alt", branches };
  }
  function parseSeq() {
    const parts = [];
    while (i < src.length && src[i] !== "|" && src[i] !== ")") parts.push(parseRepeat());
    return { t: "seq", parts };
  }
  function parseRepeat() {
    let atom = parseAtom();
    for (;;) {
      const c = src[i];
      if (c === "*") { i++; atom = { t: "star", x: atom }; }
      else if (c === "+") { i++; atom = { t: "plus", x: atom }; }
      else if (c === "?") { i++; atom = { t: "opt", x: atom }; }
      else if (c === "{") {
        const close = src.indexOf("}", i);
        const body = src.slice(i + 1, close);
        const mm = body.match(/^(\d+)(?:,(\d*))?$/);
        if (!mm) throw new Error(`unsupported quantifier {${body}}`);
        i = close + 1;
        const lo = Number(mm[1]);
        const hi = mm[2] === undefined ? lo : mm[2] === "" ? Infinity : Number(mm[2]);
        atom = { t: "rep", x: atom, lo, hi };
      } else break;
    }
    return atom;
  }
  function parseAtom() {
    const c = src[i];
    if (c === "\\") {
      const next = src[i + 1];
      i += 2;
      if (next === "d") return { t: "class" };
      if (/[1-9]/.test(next ?? "")) return { t: "lit" };
      throw new Error(`unsupported escape \\${next}`);
    }
    if (c === "[") {
      const close = src.indexOf("]", i);
      if (close < 0) throw new Error("unterminated class");
      i = close + 1;
      return { t: "class" };
    }
    if (c === "(") {
      // `(?:` is a non-capturing group: identical length semantics, skip the marker.
      if (src[i + 1] === "?") {
        if (src[i + 2] !== ":") throw new Error(`unsupported group construct ${src.slice(i, i + 4)}`);
        i += 3;
      } else {
        i++;
      }
      const inner = parseAlt();
      if (src[i] !== ")") throw new Error("unbalanced group");
      i++;
      return inner;
    }
    if (/[0-9]/.test(c)) { i++; return { t: "lit" }; }
    throw new Error(`unsupported character ${JSON.stringify(c)}`);
  }
  const ast = parseAlt();
  if (i !== src.length) throw new Error(`trailing input at ${i}`);
  return ast;
}

/** Lengths the language can realize, capped at CAP. */
function achievable(node) {
  const add = (a, b) => { const out = new Set(); for (const x of a) for (const y of b) { const s = x + y; if (s <= CAP) out.add(s); } return out; };
  switch (node.t) {
    case "lit": case "class": return new Set([1]);
    case "seq": return node.parts.reduce((acc, p) => (acc === null ? achievable(p) : add(acc, achievable(p))), null);
    case "alt": return new Set(node.branches.flatMap((b) => [...achievable(b)]));
    case "opt": return new Set([0, ...achievable(node.x)]);
    case "star": case "plus": case "rep": {
        const one = achievable(node.x);
      const lo = node.t === "star" ? 0 : node.t === "plus" ? 1 : node.lo;
      const hi = Math.min(node.t === "rep" ? node.hi : node.max ?? CAP, CAP);
      let acc = new Set(lo === 0 ? [0] : []);
      let cur = new Set([0]);
      for (let k = 1; k <= hi; k++) {
        cur = add(cur, one);
        if (k >= lo) for (const v of cur) acc.add(v);
        if (cur.size === 0) break;
      }
      return acc;
    }
    default: throw new Error(`unknown node ${node.t}`);
  }
}

// ---- per-country audit ----
const rows = [];
const overAccept = [];
const underAccept = [];
const examplesBad = [];
const parseFails = [];
for (const iso of onDisk.keys()) {
  const e = meta.countries[iso];
  if (!e) { parseFails.push(`${iso}: not in metadata`); continue; }
  const types = Array.isArray(e[11]) ? e[11] : [];
  const slot = types[1];
  const pattern = Array.isArray(slot) && typeof slot[0] === "string" ? slot[0] : "";
  const possible = (Array.isArray(slot) && Array.isArray(slot[1]) ? slot[1] : e[3]).slice().sort((a, b) => a - b);
  let real = null;
  if (!pattern) real = new Set(possible);
  else {
    try { real = achievable(parsePattern(pattern)); }
    catch (err) { parseFails.push(`${iso}: ${err.message} — pattern ${JSON.stringify(pattern).slice(0, 90)}`); real = new Set(possible); }
  }
  const realSorted = [...real].sort((a, b) => a - b);
  const mine = onDisk.get(iso).lengths;
  const over = mine.filter((l) => !real.has(l));
  const under = realSorted.filter((l) => !mine.includes(l) && l <= CAP);
  if (over.length) overAccept.push(`${iso}: table accepts ${JSON.stringify(mine)} but pattern only realizes ${JSON.stringify(realSorted)}`);
  if (under.length) underAccept.push(`${iso}: pattern realizes ${JSON.stringify(realSorted)} but table has ${JSON.stringify(mine)}`);
  const nat = examples[iso] ?? "";
  if (nat && !real.has(nat.length)) examplesBad.push(`${iso}: example ${nat} (len ${nat.length}) not realized by its own pattern`);
  // E.164 bounds the whole number at 15 digits; the field cap must not truncate a
  // real example, and the dial code must not push it over.
  const dial = onDisk.get(iso).dial;
  if (nat.length > 15) examplesBad.push(`${iso}: example alone exceeds 15 digits`);
  if (dial.length + Math.max(...real) > 15) examplesBad.push(`${iso}: dial ${dial} + longest mobile ${Math.max(...real)} exceeds E.164's 15`);
  // The placeholder shows the example *with* the trunk prefix written back, so the
  // on-disk example string must equal libphonenumber's own national formatting.
  const formatted = parsePhoneNumberFromString(nat, iso)?.formatNational() ?? "";
  const bare = formatted.replace(/\D/g, "");
  const onDiskRow = onDisk.get(iso);
  const trunk = onDiskRow.trunk ?? "";
  const withoutTrunk = trunk && bare.startsWith(trunk) ? bare.slice(trunk.length) : bare;
  if (bare !== onDiskRow.example.replace(/[ ().-]/g, "")) {
    examplesBad.push(`${iso}: table example "${onDiskRow.example}" != libphonenumber formatting "${formatted}"`);
  }
  if (withoutTrunk !== nat) {
    examplesBad.push(`${iso}: stripping the trunk from the formatted example gives ${withoutTrunk}, expected the metadata example ${nat}`);
  }
  // E.164 bounds the whole number at 15 digits; the field cap must not truncate a
  // real example, and the dial code must not push it over.
  const dialLen = onDiskRow.dial.length;
  if (nat.length > 15) examplesBad.push(`${iso}: example alone exceeds 15 digits`);
  if (dialLen + Math.max(...real) > 15) examplesBad.push(`${iso}: dial ${onDiskRow.dial} + longest mobile ${Math.max(...real)} exceeds E.164's 15`);
}
console.log("countries audited:", rows.length);
console.log("\n== OVER-ACCEPTING (table looser than the real mobile pattern) ==");
console.log(overAccept.join("\n") || "none");
console.log("\n== UNDER-ACCEPTING (table stricter than the real pattern) ==");
console.log(underAccept.join("\n") || "none");
console.log("\n== examples failing their own achievable set ==");
console.log(examplesBad.join("\n") || "none");
console.log("\n== parse failures / fallbacks ==");
console.log(parseFails.join("\n") || "none");
console.log("\n== detail: countries where possible != achievable ==");
for (const r of rows) {
  const same = r.possible.length === r.real.length && r.possible.every((l, idx) => l === r.real[idx]);
  if (!same) console.log(`${iso7(r.iso)} possible=${JSON.stringify(r.possible)} achievable=${JSON.stringify(r.real)}`);
}
function iso7(s) { return s.padEnd(3); }
