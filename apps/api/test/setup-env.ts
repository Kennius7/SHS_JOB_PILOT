import { join } from 'path';
import { tmpdir } from 'os';
import { testDatabaseUrl, testRedisUrl } from './test-env';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-0123456789-0123456789';
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'test-session-secret-0123456789-0123456789';
process.env.EMAIL_PROVIDER = 'memory';
process.env.EMAIL_FROM = 'SHS Job Pilot <no-reply@test.local>';
process.env.WEB_URL = 'http://localhost:3000';
process.env.DOCUMENT_STORAGE_PATH = join(tmpdir(), 'shs-job-pilot-test-uploads');
process.env.MAX_UPLOAD_SIZE_MB = '10';
process.env.JWT_ACCESS_TTL = '15m';
process.env.REFRESH_TOKEN_TTL_DAYS = '30';
process.env.ADMIN_EMAILS = 'admin@test.dev';
