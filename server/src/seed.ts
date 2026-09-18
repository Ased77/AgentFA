import { prisma } from "./db.js";
import { hashPassword } from "./lib/password.js";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@agentfa.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change-me-now";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`admin already exists: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: "admin",
      wallet: { create: {} },
    },
  });

  console.log(`created admin ${email} — change the password after first login`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());