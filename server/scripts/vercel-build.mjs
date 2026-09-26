// Build step for the Vercel deployment (see the root vercel.json).
//
//   1. `prisma generate`     — never ship a client generated from an older schema.
//   2. `prisma migrate deploy` — production builds only, through the direct
//      (non-pooled) connection. Preview builds must not mutate the schema.
//   3. `seed:content`        — idempotent catalog/persona upsert, skipped when
//      no database is configured.
//   4. `tsc`                 — compile the API that api/index.ts imports.
//
// Node entry points are resolved from this package's node_modules so the script
// behaves the same under npm, bun and the Vercel build container.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = (...parts) => join(serverRoot, "node_modules", ...parts);

function run(label, file, args, env = process.env) {
  console.log(`\n[build:vercel] ${label}`);
  execFileSync(process.execPath, [file, ...args], { stdio: "inherit", cwd: serverRoot, env });
}

const prismaCli = local("prisma", "build", "index.js");
const tsc = local("typescript", "bin", "tsc");
const tsx = local("tsx", "dist", "cli.mjs");

if (!existsSync(prismaCli)) {
  throw new Error(`Prisma CLI not found at ${prismaCli} — did the install step run?`);
}

run("prisma generate", prismaCli, ["generate"]);

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (process.env.VERCEL_ENV === "production") {
  if (!databaseUrl) {
    throw new Error("DIRECT_URL (or DATABASE_URL) is required to deploy migrations");
  }
  // Migrations must not run through a connection pooler.
  run("prisma migrate deploy", prismaCli, ["migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
} else {
  console.log(`\n[build:vercel] skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
}

if (databaseUrl) {
  if (!existsSync(tsx)) {
    throw new Error(`tsx not found at ${tsx} — did the install step run?`);
  }
  run("seed catalog content", tsx, ["src/seed-content.ts"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
} else {
  console.log("\n[build:vercel] skipping content seed (no DATABASE_URL)");
}

if (!existsSync(tsc)) {
  throw new Error(`tsc not found at ${tsc} — did the install step run?`);
}
run("tsc -p tsconfig.json", tsc, ["-p", "tsconfig.json"]);
