import request from 'supertest';
import { MemoryEmailSender } from '@shs/email';
import {
  createTestApp,
  TestContext,
  register,
  login,
  registerAndLogin,
  tokenFromEmail,
  truncateAll,
} from './helpers';

describe('Auth & email flows (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    MemoryEmailSender.clear();
  });

  it('sends a verification email on register and never leaks the password hash', async () => {
    const res = await register(ctx, 'newuser@test.dev').expect(201);
    expect(res.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/i);

    const message = MemoryEmailSender.last();
    expect(message?.to).toBe('newuser@test.dev');
    expect(message?.subject).toMatch(/verify/i);
    expect(message?.text).toContain('/verify-email?token=');
  });

  it('verifies an email with the emailed token and rejects reuse', async () => {
    await register(ctx, 'verify@test.dev').expect(201);
    const token = tokenFromEmail('verify');

    await request(ctx.server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200)
      .expect({ verified: true });

    const user = await ctx.prisma.user.findUnique({ where: { email: 'verify@test.dev' } });
    expect(user?.emailVerified).toBeInstanceOf(Date);

    await request(ctx.server).post('/api/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('rejects a tampered or unknown verification token', async () => {
    await register(ctx, 'tamper@test.dev').expect(201);
    await request(ctx.server)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-real-token-value' })
      .expect(400);
  });

  it('requires auth to resend verification and refuses when already verified', async () => {
    const { accessToken } = await registerAndLogin(ctx, 'resend@test.dev');
    const token = tokenFromEmail('verify');
    await request(ctx.server).post('/api/v1/auth/verify-email').send({ token }).expect(200);

    await request(ctx.server).post('/api/v1/auth/resend-verification').expect(401);
    await request(ctx.server)
      .post('/api/v1/auth/resend-verification')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('rotates the password and revokes sessions on reset', async () => {
    const { user } = await registerAndLogin(ctx, 'reset@test.dev', 'OldPassword123!');
    MemoryEmailSender.clear();

    await request(ctx.server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'reset@test.dev' })
      .expect(200);

    const token = tokenFromEmail('reset');
    await request(ctx.server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'NewPassword123!' })
      .expect(200);

    const activeSessions = await ctx.prisma.userSession.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(activeSessions).toBe(0);

    await login(ctx, 'reset@test.dev', 'OldPassword123!').expect(401);
    await login(ctx, 'reset@test.dev', 'NewPassword123!').expect(200);
  });

  it('does not reveal whether an account exists on forgot-password', async () => {
    await request(ctx.server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@test.dev' })
      .expect(200)
      .expect({ sent: true });
    expect(MemoryEmailSender.messages).toHaveLength(0);
  });
});
