import request from 'supertest';
import { PrismaService, ApplicationsService } from '@shs/data';
import {
  createTestApp,
  TestContext,
  registerAndLogin,
  truncateAll,
} from './helpers';

async function seedProviderJob(
  prisma: PrismaService,
  key = 'testprov',
  externalId = '1',
  canonicalKey = 'k1',
) {
  const provider = await prisma.jobProvider.create({
    data: {
      key,
      displayName: 'Test Provider',
      accessMode: 'PUBLIC_API',
      capabilities: {},
      enabled: true,
    },
  });
  const job = await prisma.job.create({
    data: {
      providerKey: provider.key,
      externalId,
      title: 'Backend Engineer',
      employer: 'Acme',
      sourceUrl: 'https://example.test/job/1',
      requiredSkills: [],
      preferredSkills: [],
      canonicalKey,
    },
  });
  return { provider, job };
}

describe('Security (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });

  it('rejects unknown fields on register (mass-assignment / privilege escalation)', async () => {
    await request(ctx.server)
      .post('/api/v1/auth/register')
      .send({ email: 'ma@test.dev', password: 'Password123!', role: 'ADMIN' })
      .expect(400);

    const count = await ctx.prisma.user.count({ where: { email: 'ma@test.dev' } });
    expect(count).toBe(0);
  });

  it('never returns a password hash from login', async () => {
    const { user } = await registerAndLogin(ctx, 'hash@test.dev');
    const res = await request(ctx.server)
      .post('/api/v1/auth/login')
      .send({ email: 'hash@test.dev', password: 'Password123!' })
      .expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/i);
    expect(res.body.user.id).toBe(user.id);
  });

  it('rejects a forged bearer token', async () => {
    await request(ctx.server)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.real.jwt')
      .expect(401);
  });

  it('forbids non-admins from admin endpoints', async () => {
    const { accessToken } = await registerAndLogin(ctx, 'plainuser@test.dev');
    await request(ctx.server)
      .get('/api/v1/admin/providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await request(ctx.server)
      .get('/api/v1/admin/audit')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await request(ctx.server)
      .post('/api/v1/admin/providers/testprov/sync')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('prevents cross-tenant access to applications', async () => {
    const tenantA = await registerAndLogin(ctx, 'tenant-a@test.dev');
    const tenantB = await registerAndLogin(ctx, 'tenant-b@test.dev');
    const { job } = await seedProviderJob(ctx.prisma);

    const app = await ctx.prisma.application.create({
      data: { userId: tenantA.user.id, jobId: job.id, idempotencyKey: 'a-only' },
    });

    await request(ctx.server)
      .get(`/api/v1/applications/${app.id}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(200);

    await request(ctx.server)
      .get(`/api/v1/applications/${app.id}`)
      .set('Authorization', `Bearer ${tenantB.accessToken}`)
      .expect(403);
  });

  it('prevents cross-tenant access to documents', async () => {
    const owner = await registerAndLogin(ctx, 'doc-owner@test.dev');
    const attacker = await registerAndLogin(ctx, 'doc-attacker@test.dev');

    const uploaded = await request(ctx.server)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from('%PDF-1.4 minimal'), {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    await request(ctx.server)
      .get(`/api/v1/documents/${uploaded.body.id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    await request(ctx.server)
      .get(`/api/v1/documents/${uploaded.body.id}/download`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .expect(403);
  });

  it('rejects disallowed upload types', async () => {
    const { accessToken } = await registerAndLogin(ctx, 'uploader@test.dev');
    await request(ctx.server)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('MZ\x90\x00'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);
  });

  it('de-duplicates repeated application creation (idempotency)', async () => {
    const { user } = await registerAndLogin(ctx, 'idem@test.dev');
    const { job } = await seedProviderJob(ctx.prisma);
    const applications = ctx.app.get(ApplicationsService);

    const first = await applications.createOrGet({ userId: user.id, jobId: job.id });
    const second = await applications.createOrGet({ userId: user.id, jobId: job.id });

    expect(second.id).toBe(first.id);
    const count = await ctx.prisma.application.count({
      where: { userId: user.id, jobId: job.id },
    });
    expect(count).toBe(1);
  });
});
