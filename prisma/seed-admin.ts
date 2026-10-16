/**
 * Production-safe admin seed.
 *
 * Unlike `prisma/seed.ts` (development demo data, which refuses to run with
 * NODE_ENV=production), this upserts a single ADMIN account from the
 * `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables. It is idempotent and
 * safe to run against production:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run db:seed:admin
 *
 * The password is never logged.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required.');
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN', emailVerified: new Date(), deletedAt: null },
    create: { email, passwordHash, role: 'ADMIN', emailVerified: new Date() },
    select: { id: true, email: true, role: true, emailVerified: true },
  });

  console.log(`Admin ready: ${user.email} (${user.role}, verified: ${!!user.emailVerified})`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
