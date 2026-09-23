import { prisma } from "./db.js";
import { formatPhone, normalizePhone } from "./lib/phone.js";

/**
 * Create (or promote) the admin account.
 *
 * There is no password to set: the admin signs in with an SMS code like every
 * other user, so the only thing this seed needs is the number. Run it after
 * `npm run deploy` and set `SEED_ADMIN_PHONE` to a real handset — the code is
 * delivered through whatever SMS provider the deployment has configured.
 */
async function main() {
  const input = process.env.SEED_ADMIN_PHONE ?? "09120000000";
  const normalized = normalizePhone(input);
  if (!normalized.ok) {
    throw new Error(`SEED_ADMIN_PHONE is not an Iranian mobile number: ${input}`);
  }
  const { phone } = normalized;

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    if (existing.role !== "admin") {
      await prisma.user.update({ where: { id: existing.id }, data: { role: "admin" } });
      console.log(`promoted ${formatPhone(phone)} to admin`);
      return;
    }
    console.log(`admin already exists: ${formatPhone(phone)}`);
    return;
  }

  await prisma.user.create({ data: { phone, role: "admin", wallet: { create: {} } } });
  console.log(`created admin ${formatPhone(phone)} — sign in with an SMS code`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
