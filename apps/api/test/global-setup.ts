import { execSync } from 'child_process';
import { join } from 'path';
import { testDatabaseUrl } from './test-env';

export default async function globalSetup(): Promise<void> {
  const databaseUrl = testDatabaseUrl();
  const schema = join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');
  execSync(`npx prisma migrate deploy --schema="${schema}"`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
