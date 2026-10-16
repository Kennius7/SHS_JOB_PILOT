import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MemoryEmailSender } from '@shs/email';
import { PrismaService } from '@shs/data';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  server: any;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  MemoryEmailSender.clear();
  await truncateAll(prisma);

  return { app, prisma, server: app.getHttpServer() };
}

export async function truncateAll(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const names = rows
    .map((r) => r.tablename)
    .filter((t) => !t.startsWith('_prisma'))
    .map((t) => `"public"."${t}"`);
  if (names.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`);
  }
}

export function register(ctx: TestContext, email: string, password = 'Password123!') {
  return request(ctx.server).post('/api/v1/auth/register').send({ email, password });
}

export function login(ctx: TestContext, email: string, password = 'Password123!') {
  return request(ctx.server).post('/api/v1/auth/login').send({ email, password });
}

export async function registerAndLogin(
  ctx: TestContext,
  email: string,
  password = 'Password123!',
): Promise<{ accessToken: string; user: { id: string; email: string; role: string } }> {
  await register(ctx, email, password).expect(201);
  const res = await login(ctx, email, password).expect(200);
  return res.body;
}

export function tokenFromEmail(subjectIncludes: string): string {
  const message = [...MemoryEmailSender.messages]
    .reverse()
    .find((m) => m.subject.toLowerCase().includes(subjectIncludes.toLowerCase()));
  if (!message) throw new Error(`No email found containing "${subjectIncludes}"`);
  const match = /token=([^\s&)<]+)/.exec(message.text);
  if (!match) throw new Error('No token found in email body');
  return decodeURIComponent(match[1]);
}
