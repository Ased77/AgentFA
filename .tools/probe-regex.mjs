// Quick probe of which row-parsing regex works, without shell-escaping interference.
import { readFileSync } from "node:fs";
const src = readFileSync("agentfa-web/src/lib/phone.ts", "utf8");

const candidates = {
  lazyLine: /\{ iso: "([A-Z]{2})", dial: "(\d+)", fa: "[^"]*", en: "[^"]*", trunk: "[^"]*", lengths: \[([\d, ]+)\], example: "([^"]*)"/g,
  greedy: /\{ iso: "([A-Z]{2})", dial: "(\d+)"[\s\S]*?lengths: \[([\d, ]+)\], example: "([^"]*)"/g,
};
for (const [name, re] of Object.entries(candidates)) {
  console.log(name, "matches:", [...src.matchAll(re)].length);
}
const irLine = src.split("\n").find((l) => l.includes('iso: "IR"')) ?? "(IR not on one line)";
console.log("IR line:", irLine.trim().slice(0, 120));
