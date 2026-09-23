import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { prisma } from "./db.js";
import { parseSeed, seedFile, type SeedFile } from "./seed-parse.js";

export { parseSeed, seedFile } from "./seed-parse.js";
export type { SeedAgent, SeedDivision, SeedFile } from "./seed-parse.js";

/** Idempotent: catalog content is upserted, never duplicated. */
export async function seedContent(seed: SeedFile): Promise<void> {
  // Divisions first: agents carry a foreign key to them.
  for (const division of seed.divisions) {
    await prisma.division.upsert({
      where: { slug: division.slug },
      create: division,
      update: division,
    });
  }

  for (const agent of seed.agents) {
    await prisma.agent.upsert({
      where: { id: agent.id },
      create: agent,
      update: agent,
    });

    const persona = seed.personas[agent.id];
    if (persona) {
      await prisma.persona.upsert({
        where: { agentId: agent.id },
        create: { agentId: agent.id, body: persona },
        update: { body: persona },
      });
    }
  }
}

async function main(): Promise<void> {
  if (!existsSync(seedFile)) {
    throw new Error(
      `${seedFile} is missing. Run "cd agentfa-web && bun run export:server-content" first.`,
    );
  }
  const seed = parseSeed(readFileSync(seedFile, "utf8"));
  await seedContent(seed);

  const [agents, divisions, personas] = await Promise.all([
    prisma.agent.count(),
    prisma.division.count(),
    prisma.persona.count(),
  ]);
  console.log(
    `seeded ${seed.agents.length} agents and ${seed.divisions.length} divisions — ` +
      `database holds ${agents} agents, ${divisions} divisions, ${personas} personas`,
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry === import.meta.url) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
