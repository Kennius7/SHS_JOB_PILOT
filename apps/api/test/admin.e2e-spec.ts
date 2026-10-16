import request from 'supertest';
import {
  createTestApp,
  TestContext,
  register,
  login,
  registerAndLogin,
  truncateAll,
} from './helpers';

async function registerAdmin(ctx: TestContext, email: string) {
  await register(ctx, email).expect(201);
  await ctx.prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
  const res = await login(ctx, email).expect(200);
  return res.body as {
    accessToken: string;
    user: { email: string; role: string; isAdmin: boolean };
  };
}

describe('Admin console (integration)', () => {
  let ctx: TestContext;
  const ALLOWED = 'admin@test.dev';

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });

  it('flags the allowlisted admin as isAdmin on login', async () => {
    const { user } = await registerAdmin(ctx, ALLOWED);
    expect(user.role).toBe('ADMIN');
    expect(user.isAdmin).toBe(true);
  });

  it('flags a non-allowlisted admin as not isAdmin', async () => {
    const { user } = await registerAdmin(ctx, 'rogue-admin@test.dev');
    expect(user.role).toBe('ADMIN');
    expect(user.isAdmin).toBe(false);
  });

  it('exposes isAdmin on /users/me', async () => {
    const { accessToken } = await registerAdmin(ctx, ALLOWED);
    const res = await request(ctx.server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.isAdmin).toBe(true);

    const plain = await registerAndLogin(ctx, 'plain-me@test.dev');
    const me = await request(ctx.server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${plain.accessToken}`)
      .expect(200);
    expect(me.body.isAdmin).toBe(false);
  });

  it('lets the allowlisted admin reach every admin endpoint', async () => {
    const { accessToken } = await registerAdmin(ctx, ALLOWED);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const health = await request(ctx.server).get('/api/v1/admin/health').set(auth).expect(200);
    expect(health.body.status).toBeDefined();

    const workers = await request(ctx.server).get('/api/v1/admin/workers').set(auth).expect(200);
    expect(Array.isArray(workers.body.queues)).toBe(true);

    const tables = await request(ctx.server).get('/api/v1/admin/db/tables').set(auth).expect(200);
    expect(tables.body.tables.length).toBeGreaterThan(0);

    const first = tables.body.tables[0].name as string;
    const rows = await request(ctx.server)
      .get(`/api/v1/admin/db/tables/${encodeURIComponent(first)}/rows?limit=5`)
      .set(auth)
      .expect(200);
    expect(rows.body.table).toBe(first);
    expect(Array.isArray(rows.body.columns)).toBe(true);
    expect(Array.isArray(rows.body.rows)).toBe(true);

    const redisKeys = await request(ctx.server)
      .get('/api/v1/admin/redis/keys?pattern=*&limit=5')
      .set(auth)
      .expect(200);
    expect(Array.isArray(redisKeys.body.keys)).toBe(true);

    const missingKey = await request(ctx.server)
      .get('/api/v1/admin/redis/key?key=definitely-not-a-real-key')
      .set(auth)
      .expect(200);
    expect(missingKey.body.type).toBe('none');
  });

  it('rejects an ADMIN whose email is not on the allowlist', async () => {
    const { accessToken } = await registerAdmin(ctx, 'rogue-admin@test.dev');
    await request(ctx.server)
      .get('/api/v1/admin/health')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await request(ctx.server)
      .get('/api/v1/admin/db/tables')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('forbids a normal user from the database, redis and worker endpoints', async () => {
    const { accessToken } = await registerAndLogin(ctx, 'nobody@test.dev');
    const auth = { Authorization: `Bearer ${accessToken}` };
    for (const path of [
      '/api/v1/admin/workers',
      '/api/v1/admin/db/tables',
      '/api/v1/admin/db/tables/User/rows',
      '/api/v1/admin/redis/keys',
      '/api/v1/admin/redis/key?key=x',
    ]) {
      await request(ctx.server).get(path).set(auth).expect(403);
    }
  });

  it('rejects an unknown or invalid table name', async () => {
    const { accessToken } = await registerAdmin(ctx, ALLOWED);
    const auth = { Authorization: `Bearer ${accessToken}` };

    await request(ctx.server).get('/api/v1/admin/db/tables/NoSuchTable/rows').set(auth).expect(404);

    await request(ctx.server)
      .get('/api/v1/admin/db/tables/User%3B%20DROP%20TABLE%20X/rows')
      .set(auth)
      .expect(400);
  });
});
