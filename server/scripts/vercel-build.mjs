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

/** Vercel can define a variable as an empty string; treat that as "not set". */
const envValue = (name) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

/** Connection used by app + seed (pooled). */
const databaseUrl = envValue("DATABASE_URL");
/** Connection used by migrations (direct, non-pooled); falls back to the pooled one. */
const directUrl = envValue("DIRECT_URL") ?? databaseUrl;
/** True only for Vercel Production deployments. */
const isProduction = process.env.VERCEL_ENV === "production";

const prismaCli = local("prisma", "build", "index.js");
const tsc = local("typescript", "bin", "tsc");
const tsx = local("tsx", "dist", "cli.mjs");

if (!existsSync(prismaCli)) {
  throw new Error(`Prisma CLI not found at ${prismaCli} — did the install step run?`);
}

run("prisma generate", prismaCli, ["generate"]);

if (isProduction) {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL (and DIRECT_URL) are required to deploy migrations.\n" +
        "Set them for this Vercel project under Settings > Environment Variables,\n" +
        "scope: Production (and Preview if you want migrations there too),\n" +
        "then redeploy.",
    );
  }
  // Migrations must not run through a connection pooler: statements may be
  // sent through different pooler sessions and transactional DDL guarantees
  // are lost. Point DATABASE_URL (and DIRECT_URL, for the schema's directUrl)
  // at the direct connection for this one command.
  run("prisma migrate deploy", prismaCli, ["migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: directUrl,
    DIRECT_URL: directUrl,
  });
} else {
  console.log(
    `\n[build:vercel] skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`,
  );
}

if (databaseUrl) {
  if (!existsSync(tsx)) {
    throw new Error(`tsx not found at ${tsx} — did the install step run?`);
  }
  // Idempotent catalog/persona upsert, kept non-fatal: a transient pooler
  // hiccup should not fail an otherwise-good build.
  try {
    run("seed catalog content", tsx, ["src/seed-content.ts"], {
      ...process.env,
      DATABASE_URL: databaseUrl,
    });
  } catch (error) {
    console.warn(`\n[build:vercel] content seed failed (non-fatal): ${error?.message ?? error}`);
  }
} else {
  console.log("\n[build:vercel] skipping content seed (no DATABASE_URL)");
}

if (!existsSync(tsc)) {
  throw new Error(`tsc not found at ${tsc} — did the install step run?`);
}
run("tsc -p tsconfig.json", tsc, ["-p", "tsconfig.json"]);
