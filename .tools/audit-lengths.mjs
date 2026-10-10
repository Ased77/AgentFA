/**
 * Audit: are the `lengths` arrays in `agentfa-web/src/lib/phone.ts` correct?
 *
 * Ground truth is libphonenumber's metadata for the MOBILE number type — the same
 * ITU/E.164 numbering-plan data the table was written from. In
 * `metadata.mobile.json` each country entry is a flat array whose type-specific
 * slot is the last element:
 *
 *   [ ..., [ mobileNationalNumberPattern, mobilePossibleLengths? ] ]
 *
 * Three independent checks run per row:
 *   1. `lengths` vs the curated `mobilePossibleLengths` (or, when absent, the
 *      lengths the mobile pattern can realize).
 *   2. Realizability: every length the table accepts must be reachable by a
 *      concrete national number that libphonenumber itself accepts as a MOBILE.
 *   3. The placeholder example and `trunk` field must agree with the plan.
 *
 * libphonenumber is deliberately NOT a project dependency, so this script expects
 * it in a scratch install and says so if it is missing:
 *
 *   mkdir -p /tmp/pl3 && cd /tmp/pl3
 *   npm install libphonenumber-js
 *   node .tools/audit-lengths.mjs            # add LP_DIR=/tmp/pl3 to override
 *
 * Exit code is non-zero when any row disagrees with the plan.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const lpDir = process.env.LP_DIR
  ? join(process.env.LP_DIR, "node_modules", "libphonenumber-js")
  : join(tmpdir(), "pl3", "node_modules", "libphonenumber-js");

let meta;
let examples;
let parsePhoneNumberFromString;
try {
  meta = JSON.parse(readFileSync(join(lpDir, "metadata.mobile.json"), "utf8"));
  examples = JSON.parse(readFileSync(join(lpDir, "mobile", "examples", "examples.mobile.json"), "utf8"));
  ({ parsePhoneNumberFromString } = await import(new URL(`file://${lpDir.replace(/\\/g, "/")}/mobile/index.js`)));
} catch (err) {
  console.error(`Cannot load libphonenumber from ${lpDir}: ${err.message}`);
  console.error("Install it in a scratch dir (see the header of this file) and re-run.");
  process.exit(2);
}
const isValid = (e164) => Boolean(parsePhoneNumberFromString(e164)?.isValid());

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// PHONE_TS lets the audit run against a mutated copy, to prove it can fail.
const phonePath = process.env.PHONE_TS ?? join(root, "agentfa-web", "src", "lib", "phone.ts");
const phoneSrc = readFileSync(phonePath, "utf8");

// ---- the on-disk table, parsed straight from the source ----
// Slice the source at every `iso: "XX"` so a row's body runs to the next row. This
// survives field reordering, multi-line rows, multi-line names, and the IRAN
// constant's regex pattern (whose `{`/`}` would otherwise break brace matching).
const onDisk = new Map();
const anchors = [...phoneSrc.matchAll(/iso: "([A-Z]{2})"/g)].map((m) => ({ iso: m[1], at: m.index }));
anchors.forEach((anchor, i) => {
  const body = phoneSrc.slice(anchor.at, anchors[i + 1]?.at ?? phoneSrc.length);
  const field = (name) => body.match(new RegExp(`${name}: "([^"]*)"`))?.[1];
  const lengthsHit = body.match(/lengths: \[([\d, ]*)\]/);
  if (!lengthsHit) return;
  onDisk.set(anchor.iso, {
    dial: field("dial"),
    trunk: field("trunk") ?? "",
    example: field("example"),
    lengths: lengthsHit[1].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)),
  });
});
if (onDisk.size < 80) {
  console.error(`Only parsed ${onDisk.size} rows out of phone.ts — the parser is out of date.`);
  process.exit(2);
}

// ---- a tiny model + solver for the regex subset libphonenumber patterns use ----
const CAP = 20;
const DIGITS = [..."0123456789"];

function parsePattern(src) {
  let i = 0;
  const parseAlt = () => {
    const branches = [parseSeq()];
    while (src[i] === "|") { i++; branches.push(parseSeq()); }
    return branches.length === 1 ? branches[0] : { t: "alt", branches };
  };
  const parseSeq = () => {
    const parts = [];
    while (i < src.length && src[i] !== "|" && src[i] !== ")") parts.push(parseRepeat());
    return { t: "seq", parts };
  };
  const parseRepeat = () => {
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
        const hi = mm[2] === undefined ? lo : mm[2] === "" ? CAP : Number(mm[2]);
        atom = { t: "rep", x: atom, lo, hi };
      } else break;
    }
    return atom;
  };
  const parseClass = () => {
    const close = src.indexOf("]", i);
    if (close < 0) throw new Error("unterminated class");
    const body = src.slice(i + 1, close);
    i = close + 1;
    const chars = new Set();
    for (let k = 0; k < body.length; k++) {
      if (body[k] === "\\" && body[k + 1] === "d") { DIGITS.forEach((d) => chars.add(d)); k++; continue; }
      const lo = body[k];
      if (body[k + 1] === "-" && /[0-9]/.test(body[k + 2] ?? "")) {
        for (let d = Number(lo); d <= Number(body[k + 2]); d++) chars.add(String(d));
        k += 2;
      } else if (/[0-9]/.test(lo)) chars.add(lo);
    }
    if (!chars.size) throw new Error(`empty class [${body}]`);
    return { t: "class", chars: [...chars] };
  };
  const parseAtom = () => {
    const c = src[i];
    if (c === "\\") {
      const next = src[i + 1];
      i += 2;
      if (next === "d") return { t: "class", chars: DIGITS };
      if (/[0-9]/.test(next ?? "")) return { t: "class", chars: [next] };
      throw new Error(`unsupported escape \\${next}`);
    }
    if (c === "[") return parseClass();
    if (c === "(") {
      // `(?:` is a non-capturing group: same length semantics, skip the marker.
      if (src[i + 1] === "?") {
        if (src[i + 2] !== ":") throw new Error(`unsupported group construct ${src.slice(i, i + 4)}`);
        i += 3;
      } else i++;
      const inner = parseAlt();
      if (src[i] !== ")") throw new Error("unbalanced group");
      i++;
      return inner;
    }
    if (/[0-9]/.test(c)) { i++; return { t: "class", chars: [c] }; }
    throw new Error(`unsupported character ${JSON.stringify(c)}`);
  };
  const ast = parseAlt();
  if (i !== src.length) throw new Error(`trailing input at ${i}`);
  return ast;
}

/** Every length (<= CAP) the pattern language can realize. */
function achievable(node) {
  const add = (a, b) => {
    const out = new Set();
    for (const x of a) for (const y of b) { const s = x + y; if (s <= CAP) out.add(s); }
    return out;
  };
  switch (node.t) {
    case "class":
      return new Set([1]);
    case "seq":
      return node.parts.reduce((acc, p) => (acc === null ? achievable(p) : add(acc, achievable(p))), null);
    case "alt":
      return new Set(node.branches.flatMap((b) => [...achievable(b)]));
    case "opt":
      return new Set([0, ...achievable(node.x)]);
    case "star":
    case "plus":
    case "rep": {
      const one = achievable(node.x);
      const lo = node.t === "star" ? 0 : node.t === "plus" ? 1 : node.lo;
      const hi = node.t === "rep" ? Math.min(node.hi, CAP) : CAP;
      const acc = new Set(lo === 0 ? [0] : []);
      let cur = new Set([0]);
      for (let k = 1; k <= hi; k++) {
        cur = add(cur, one);
        if (k >= lo) for (const v of cur) acc.add(v);
        if (cur.size === 0) break;
      }
      return acc;
    }
    default:
      throw new Error(`unknown node ${node.t}`);
  }
}

const BUDGET = 24;
const MIN = (s) => (s.size ? Math.min(...s) : 0);

/** Up to BUDGET concrete strings the node can realize at exactly `len` digits. */
function sample(node, len, budget = BUDGET) {
  if (len < 0) return [];
  switch (node.t) {
    case "class":
      return len === 1 ? node.chars.slice(0, budget) : [];
    case "seq": {
      const parts = node.parts;
      const out = [];
      const rec = (idx, rem, prefix) => {
        if (out.length >= budget) return;
        if (idx === parts.length) { if (rem === 0) out.push(prefix); return; }
        for (const s of [...achievable(parts[idx])].sort((a, b) => a - b)) {
          if (s > rem) break;
          if (out.length >= budget) return;
          for (const piece of sample(parts[idx], s, budget)) {
            rec(idx + 1, rem - s, prefix + piece);
            if (out.length >= budget) return;
          }
        }
      };
      rec(0, len, "");
      return out;
    }
    case "alt": {
      const out = [];
      for (const b of node.branches) {
        out.push(...sample(b, len, budget - out.length));
        if (out.length >= budget) break;
      }
      return out;
    }
    case "opt": {
      const out = len === 0 ? [""] : [];
      if (out.length < budget) out.push(...sample(node.x, len, budget - out.length));
      return out;
    }
    case "star":
    case "plus":
    case "rep": {
      const one = achievable(node.x);
      const lo = node.t === "star" ? 0 : node.t === "plus" ? 1 : node.lo;
      const hi = node.t === "rep" ? Math.min(node.hi, len) : len;
      const out = [];
      const rec = (k, rem, prefix) => {
        if (out.length >= budget) return;
        if (k === 0) { if (rem === 0) out.push(prefix); return; }
        for (const s of [...one].sort((a, b) => a - b)) {
          if (s > rem) continue;
          if (k > 1 && rem - s < (k - 1) * MIN(one)) continue;
          for (const piece of sample(node.x, s, budget)) {
            rec(k - 1, rem - s, prefix + piece);
            if (out.length >= budget) return;
          }
        }
      };
      for (let k = Math.min(hi, len); k >= lo; k--) {
        if (k * MIN(one) > len) continue;
        rec(k, len, "");
        if (out.length >= budget) break;
      }
      return out;
    }
    default:
      throw new Error(`unknown node ${node.t}`);
  }
}

/** The MOBILE type spec for a country: `{ pattern, lengths }` (`lengths` may be null). */
function mobileSpec(iso) {
  const entry = meta.countries[iso];
  const tail = Array.isArray(entry) ? entry[11] : undefined;
  if (!Array.isArray(tail) || !Array.isArray(tail[1]) || typeof tail[1][0] !== "string") return null;
  const [pattern, lengths] = tail[1];
  return {
    pattern,
    lengths: Array.isArray(lengths) ? [...lengths].sort((a, b) => a - b) : null,
    nationalPrefix: typeof entry[5] === "string" ? entry[5] : "",
    dial: entry[0],
  };
}

// ---- the audit ----
const over = [];
const under = [];
const unrealizable = [];
const exampleBad = [];
const trunkBad = [];
const unknown = [];
const skipped = [];
const patternWider = [];
const trunkOmitted = [];
const built = new Map();

console.log(`countries audited: ${onDisk.size}`);
console.log("ground truth: metadata.mobile.json MOBILE type (curated lengths, plus a reachability proof)\n");

for (const [iso, row] of onDisk) {
  const spec = mobileSpec(iso);
  if (!spec) { unknown.push(iso); continue; }
  let ast;
  let real;
  try {
    ast = parsePattern(spec.pattern);
    real = achievable(ast);
  } catch (err) {
    skipped.push(`${iso}: ${err.message} — ${JSON.stringify(spec.pattern).slice(0, 70)}`);
    continue;
  }
  const realSorted = [...real].sort((a, b) => a - b);
  const truth = spec.lengths ?? realSorted;
  const truthSet = new Set(truth);
  const mine = [...row.lengths].sort((a, b) => a - b);
  built.set(iso, ast);

  const tooLoose = mine.filter((l) => !truthSet.has(l));
  const tooTight = truth.filter((l) => !mine.includes(l));
  if (tooLoose.length) over.push(`${iso}: table ${JSON.stringify(mine)} accepts ${JSON.stringify(tooLoose)}, plan allows ${JSON.stringify(truth)}`);
  if (tooTight.length) under.push(`${iso}: plan allows ${JSON.stringify(truth)}, table ${JSON.stringify(mine)} is missing ${JSON.stringify(tooTight)}`);
  if (spec.lengths && realSorted.some((l) => !truthSet.has(l))) {
    patternWider.push(`${iso}: pattern can realize ${JSON.stringify(realSorted)} but plan lists ${JSON.stringify(truth)} — pattern is looser (informational)`);
  }

  // Reachability: each accepted length needs at least one number that libphonenumber
  // itself validates as a mobile, otherwise the table is accepting lengths that no
  // real subscriber number can have.
  for (const l of mine) {
    if (!real.has(l)) { unrealizable.push(`${iso}: table accepts ${l} digits, mobile pattern cannot produce it (pattern realizes ${JSON.stringify(realSorted)})`); continue; }
    const candidates = sample(ast, l, 200);
    if (!candidates.some((nat) => isValid(`+${row.dial}${nat}`))) {
      unrealizable.push(`${iso}: no valid ${row.dial} mobile of ${l} digits found among ${candidates.length} pattern samples (${candidates.slice(0, 3).join(", ")}…)`);
    }
  }

  // `trunk` is the national prefix the normalizer strips, so it must match the plan's.
  if (String(spec.nationalPrefix) !== String(row.trunk)) {
    trunkBad.push(`${iso}: table trunk ${JSON.stringify(row.trunk)} but plan national prefix is ${JSON.stringify(spec.nationalPrefix)}`);
  }

  // The example must be a real mobile the table accepts. Placeholders may be written
  // with or without the trunk prefix — both are legitimate national spellings — so
  // strip it when present and validate the result either way.
  const nat = examples[iso] ?? "";
  if (nat && !mine.includes(nat.length)) exampleBad.push(`${iso}: plan example ${nat} (${nat.length} digits) not accepted by table ${JSON.stringify(mine)}`);
  if (nat && !isValid(`+${row.dial}${nat}`)) exampleBad.push(`${iso}: plan example ${nat} is not a valid ${iso} mobile per libphonenumber`);

  const bare = (row.example ?? "").replace(/[^\d]/g, "");
  const hasTrunk = Boolean(row.trunk) && bare.startsWith(row.trunk);
  const national = hasTrunk ? bare.slice(row.trunk.length) : bare;
  if (row.example && !trunkBad.some((s) => s.startsWith(`${iso}:`))) {
    if (hasTrunk) { /* canonical spelling */ }
    else if (row.trunk) trunkOmitted.push(`${iso}: example ${row.example} omits trunk ${row.trunk} (valid national spelling)`);
  }
  if (national && !mine.includes(national.length)) {
    exampleBad.push(`${iso}: example ${row.example} is ${national.length} digits without the trunk, outside table ${JSON.stringify(mine)}`);
  }
  if (national && !isValid(`+${row.dial}${national}`)) {
    exampleBad.push(`${iso}: example ${row.example} (as ${national}) is not a valid ${iso} mobile per libphonenumber`);
  }

  // E.164 caps the whole number at 15 digits; a dial code plus a real mobile must fit.
  const longest = Math.max(...truth);
  if (row.dial.length + longest > 15) exampleBad.push(`${iso}: dial ${row.dial} + longest mobile ${longest} exceeds E.164's 15 digits`);
}

const section = (title, list) => {
  console.log(`\n== ${title} (${list.length}) ==`);
  console.log(list.join("\n") || "none");
};
section("OVER-ACCEPTING: table accepts a length the mobile plan does not allow", over);
section("UNDER-ACCEPTING: a planned mobile length is refused by the table", under);
section("UNREALIZABLE: accepted length with no valid mobile behind it", unrealizable);
section("TRUNK: table's national prefix disagrees with the plan", trunkBad);
section("EXAMPLE / E.164 problems", exampleBad);
section("countries missing a mobile spec in metadata", unknown);
section("pattern parse failures (skipped)", skipped);
section("informational: pattern looser than the curated length list", patternWider);
section("informational: example omits the trunk prefix (valid national spelling)", trunkOmitted);

const failures =
  over.length + under.length + unrealizable.length + trunkBad.length + exampleBad.length + unknown.length + skipped.length;
console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} finding(s)`);
process.exit(failures === 0 ? 0 : 1);
