import { readFileSync } from 'fs';
import { join } from 'path';

export function rootEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const txt = readFileSync(join(__dirname, '..', '..', '..', '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    // .env is optional; fall back to process.env below.
  }
  return out;
}

export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = rootEnv().DATABASE_URL ?? process.env.DATABASE_URL;
  if (base) {
    try {
      const url = new URL(base);
      url.pathname = '/jobpilot_test';
      return url.toString();
    } catch {
      // fall through to the default
    }
  }
  return 'postgresql://jobpilot:jobpilot@localhost:5432/jobpilot_test?schema=public';
}

export function testRedisUrl(): string {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  const base = rootEnv().REDIS_URL ?? process.env.REDIS_URL;
  if (base) {
    try {
      const url = new URL(base);
      url.pathname = '/1';
      return url.toString();
    } catch {
      // fall through to the default
    }
  }
  return 'redis://localhost:6379/1';
}
