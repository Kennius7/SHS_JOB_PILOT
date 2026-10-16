#!/usr/bin/env bash
#
# LEGACY / DO NOT USE — kept for historical reference only. This one-shot
# scaffolding script predates the current project layout (pnpm workspaces + the
# old Turbo "pipeline" key) and omits later slices (e.g. the email/auth flows).
# It is NOT part of the build, CI, or deployment; the repository is the source
# of truth.
# SHS Job Pilot — Part 3: packages/data, apps/api
set -euo pipefail

echo "→ Creating directory tree (part 3)"
mkdir -p packages/data/src/prisma packages/data/src/services
mkdir -p apps/api/src/prisma
mkdir -p apps/api/src/modules/auth
mkdir -p apps/api/src/modules/profile
mkdir -p apps/api/src/modules/documents
mkdir -p apps/api/src/modules/rules
mkdir -p apps/api/src/modules/applications
mkdir -p apps/api/src/modules/admin

# ============================================================
# packages/data
# ============================================================

cat > packages/data/package.json <<'EOF'
{
  "name": "@shs/data",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@prisma/client": "^6.1.0",
    "@shs/ai": "workspace:*",
    "@shs/rules": "workspace:*",
    "@shs/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
EOF

cat > packages/data/tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
EOF

cat > packages/data/src/index.ts <<'EOF'
export * from './data.module';
export * from './prisma/prisma.service';
export * from './services/transitions.service';
export * from './services/applications.service';
export * from './services/ai.service';
EOF

cat > packages/data/src/prisma/prisma.service.ts <<'EOF'
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
EOF

cat > packages/data/src/data.module.ts <<'EOF'
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { TransitionsService } from './services/transitions.service';
import { ApplicationsService } from './services/applications.service';
import { AiService } from './services/ai.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrismaService, TransitionsService, ApplicationsService, AiService],
  exports: [PrismaService, TransitionsService, ApplicationsService, AiService],
})
export class DataModule {}
EOF

cat > packages/data/src/services/transitions.service.ts <<'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplicationState,
  assertCanTransition,
  IllegalStateTransitionError,
} from '@shs/shared';

interface TransitionOptions {
  note?: string;
  metadata?: Record<string, unknown>;
  providerRefId?: string;
  confirmationEvidence?: Record<string, unknown>;
  lastError?: string;
  withinTx?: (tx: any) => Promise<void>;
}

const USER_NOTIFY_STATES: ApplicationState[] = [
  'AWAITING_APPROVAL',
  'SUBMITTED',
  'CONFIRMED',
  'FAILED',
  'NEEDS_USER_INPUT',
  'MANUAL_APPLICATION_REQUIRED',
];

@Injectable()
export class TransitionsService {
  private readonly logger = new Logger(TransitionsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Atomic transition + status event + optional notification.
   * Uses SELECT ... FOR UPDATE so concurrent workers cannot race.
   */
  async transition(
    applicationId: string,
    to: ApplicationState,
    opts: TransitionOptions = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [app] = await tx.$queryRaw<
        { id: string; state: ApplicationState; userId: string }[]
      >`SELECT id, state, "userId" FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;

      if (!app) throw new Error(`Application ${applicationId} not found`);

      try {
        assertCanTransition(app.state, to);
      } catch (e) {
        if (e instanceof IllegalStateTransitionError) {
          this.logger.warn(`Rejected transition ${e.from} -> ${e.to} for ${applicationId}`);
          throw e;
        }
        throw e;
      }

      const now = new Date();
      const data: Record<string, unknown> = { state: to };
      if (to === 'SUBMITTED') data.submittedAt = now;
      if (to === 'CONFIRMED') data.confirmedAt = now;
      if (opts.providerRefId) data.providerRefId = opts.providerRefId;
      if (opts.confirmationEvidence) data.confirmationEvidence = opts.confirmationEvidence;
      if (opts.lastError !== undefined) {
        data.lastError = opts.lastError;
        data.lastErrorAt = opts.lastError ? now : null;
      }

      await tx.application.update({ where: { id: applicationId }, data });

      await tx.applicationStatusEvent.create({
        data: {
          applicationId,
          fromState: app.state,
          toState: to,
          note: opts.note,
          metadata: opts.metadata as any,
        },
      });

      if (USER_NOTIFY_STATES.includes(to)) {
        await this.createNotification(tx, app.userId, applicationId, to, opts);
      }

      if (opts.withinTx) await opts.withinTx(tx);

      return { from: app.state, to };
    });
  }

  private async createNotification(
    tx: any,
    userId: string,
    applicationId: string,
    state: ApplicationState,
    opts: TransitionOptions,
  ) {
    const templates: Partial<Record<ApplicationState, { type: string; title: string }>> = {
      AWAITING_APPROVAL: { type: 'AWAITING_APPROVAL', title: 'Application ready for review' },
      SUBMITTED: { type: 'SUBMITTED', title: 'Application submitted' },
      CONFIRMED: { type: 'CONFIRMED', title: 'Application confirmed' },
      FAILED: { type: 'FAILED', title: 'Application failed' },
      NEEDS_USER_INPUT: { type: 'NEEDS_USER_INPUT', title: 'Application needs your input' },
      MANUAL_APPLICATION_REQUIRED: {
        type: 'MANUAL_APPLICATION_REQUIRED',
        title: 'Manual application required',
      },
    };
    const template = templates[state];
    if (!template) return;
    await tx.notification.create({
      data: {
        userId,
        type: template.type,
        title: template.title,
        body: opts.note ?? template.title,
        metadata: { applicationId, ...(opts.metadata ?? {}) },
      },
    });
  }
}
EOF

cat > packages/data/src/services/applications.service.ts <<'EOF'
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransitionsService } from './transitions.service';
import { ApplicationState, USER_SKIPPABLE } from '@shs/shared';
import { createHash } from 'crypto';

interface CreateApplicationInput {
  userId: string;
  jobId: string;
  matchScore?: number;
  ruleEvalJson?: unknown;
}

interface GuardOptions {
  requireAutomation: boolean;
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private prisma: PrismaService,
    private transitions: TransitionsService,
  ) {}

  async list(userId: string, state?: ApplicationState) {
    return this.prisma.application.findMany({
      where: { userId, ...(state ? { state } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        job: {
          select: {
            id: true, title: true, employer: true, applyUrl: true,
            sourceUrl: true, providerKey: true,
          },
        },
      },
    });
  }

  async get(userId: string, applicationId: string) {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: true,
        materials: true,
        events: { orderBy: { createdAt: 'asc' } },
        attempts: { orderBy: { attemptNumber: 'asc' } },
      },
    });
    if (!app) throw new NotFoundException();
    if (app.userId !== userId) throw new ForbiddenException();
    return app;
  }

  async createOrGet(input: CreateApplicationInput) {
    const idempotencyKey = createHash('sha256')
      .update(`${input.userId}:${input.jobId}`)
      .digest('hex');

    const existing = await this.prisma.application.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;

    try {
      return await this.prisma.application.create({
        data: {
          userId: input.userId,
          jobId: input.jobId,
          state: 'DISCOVERED',
          matchScore: input.matchScore,
          ruleEvalJson: input.ruleEvalJson as any,
          idempotencyKey,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        return this.prisma.application.findUniqueOrThrow({ where: { idempotencyKey } });
      }
      throw e;
    }
  }

  async approve(userId: string, applicationId: string) {
    const app = await this.requireOwned(userId, applicationId);
    await this.runSubmissionGuards(userId, app, { requireAutomation: false });
    return this.transitions.transition(applicationId, 'QUEUED', {
      note: 'User approved',
      metadata: { approvedBy: userId, approvedAt: new Date().toISOString() },
    });
  }

  async skip(userId: string, applicationId: string, reason?: string) {
    const app = await this.requireOwned(userId, applicationId);
    if (!USER_SKIPPABLE.includes(app.state as ApplicationState)) {
      throw new BadRequestException(`Cannot skip application in state ${app.state}`);
    }
    return this.transitions.transition(applicationId, 'SKIPPED', {
      note: reason ?? 'User skipped',
      metadata: { skippedBy: userId },
    });
  }

  async autoQueue(userId: string, applicationId: string) {
    const app = await this.requireOwned(userId, applicationId);
    await this.runSubmissionGuards(userId, app, { requireAutomation: true });
    return this.transitions.transition(applicationId, 'QUEUED', {
      note: 'Auto-queued by rules engine',
    });
  }

  async requireApproval(userId: string, applicationId: string) {
    await this.requireOwned(userId, applicationId);
    return this.transitions.transition(applicationId, 'AWAITING_APPROVAL', {
      note: 'Awaiting user approval',
    });
  }

  private async requireOwned(userId: string, applicationId: string) {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException();
    if (app.userId !== userId) throw new ForbiddenException();
    return app;
  }

  private async runSubmissionGuards(
    userId: string,
    app: { id: string; jobId: string; state: string },
    opts: GuardOptions,
  ) {
    const [user, job, prefs, activeRule] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.job.findUnique({ where: { id: app.jobId } }),
      this.prisma.careerPreference.findFirst({ where: { profile: { userId } } }),
      this.prisma.applicationRule.findFirst({ where: { userId, isActive: true } }),
    ]);

    if (!user || user.deletedAt || !user.isActive) {
      throw new BadRequestException('Account is not active');
    }
    if (!job) throw new BadRequestException('Job no longer exists');
    if (job.status !== 'ACTIVE') {
      throw new BadRequestException(`Job is ${job.status.toLowerCase()}`);
    }
    if (job.closingAt && job.closingAt < new Date()) {
      throw new BadRequestException('Job has closed');
    }
    if (!prefs) throw new BadRequestException('Career preferences not configured');
    if (!activeRule) throw new BadRequestException('No active application rule');

    if (opts.requireAutomation && !prefs.autoSubmitEnabled) {
      throw new BadRequestException('Automatic submission is disabled');
    }

    const dupes = await this.prisma.application.count({
      where: {
        userId,
        jobId: app.jobId,
        id: { not: app.id },
        state: { in: ['SUBMITTING', 'SUBMITTED', 'CONFIRMED'] },
      },
    });
    if (dupes > 0) throw new BadRequestException('Already applied to this job');

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [dailyCount, weeklyCount] = await Promise.all([
      this.prisma.application.count({
        where: {
          userId,
          state: { in: ['QUEUED', 'SUBMITTING', 'SUBMITTED', 'CONFIRMED'] },
          updatedAt: { gte: startOfDay },
        },
      }),
      this.prisma.application.count({
        where: {
          userId,
          state: { in: ['QUEUED', 'SUBMITTING', 'SUBMITTED', 'CONFIRMED'] },
          updatedAt: { gte: startOfWeek },
        },
      }),
    ]);

    if (dailyCount >= prefs.maxApplicationsPerDay) {
      throw new BadRequestException(`Daily limit reached (${prefs.maxApplicationsPerDay})`);
    }
    if (weeklyCount >= prefs.maxApplicationsPerWeek) {
      throw new BadRequestException(`Weekly limit reached (${prefs.maxApplicationsPerWeek})`);
    }

    const provider = await this.prisma.jobProvider.findUnique({
      where: { key: job.providerKey },
    });
    if (!provider) throw new BadRequestException('Provider not registered');
    if (!provider.enabled) throw new BadRequestException('Provider disabled');
    const caps = provider.capabilities as { submitApplications?: boolean };
    if (!caps.submitApplications) {
      throw new BadRequestException(
        `Provider ${provider.displayName} does not support automated submission`,
      );
    }
  }
}
EOF

cat > packages/data/src/services/ai.service.ts <<'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeminiAdapter,
  AiBudgetService,
  estimateTokens,
  type MatchInput,
  type CoverLetterInput,
  type ParsedCv,
  type MatchScore,
} from '@shs/ai';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Runtime AI facade with mock mode. Both the API and the worker use this.
 * In mock mode (no key, or AI_MOCK_MODE=true) returns deterministic data so
 * the pipeline runs end-to-end without any external calls.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private adapter: GeminiAdapter | null = null;
  private budget: AiBudgetService | null = null;
  private readonly mock: boolean;
  private readonly model: string;

  constructor(config: ConfigService, private prisma: PrismaService) {
    this.model = config.get('AI_MODEL', 'gemini-3.8-flash');
    const apiKey = config.get<string>('AI_API_KEY');
    this.mock = !apiKey || config.get('AI_MOCK_MODE') === 'true';

    if (!this.mock && apiKey) {
      this.adapter = new GeminiAdapter(apiKey, this.model);
      this.budget = new AiBudgetService(prisma as any, {
        userMonthlyBudgetUsd: Number(config.get('AI_PER_USER_MONTHLY_BUDGET_USD', 2)),
        platformMonthlyBudgetUsd: Number(config.get('AI_MONTHLY_BUDGET_USD', 25)),
      });
    } else {
      this.logger.warn('AI running in MOCK mode — no real API calls will be made');
    }
  }

  isMock(): boolean {
    return this.mock;
  }

  async parseCv(userId: string, text: string): Promise<ParsedCv> {
    if (this.mock) {
      return {
        fullName: 'Mock Candidate',
        skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
        experience: [{ title: 'Software Engineer', employer: 'Mock Corp' }],
        education: [{ institution: 'Mock University', degree: 'BSc' }],
        yearsExperience: 5,
      };
    }
    await this.budget!.checkBudget(userId);
    const result = await this.adapter!.parseCv(text);
    await this.budget!.recordUsage(userId, estimateTokens(text), 1000, this.model);
    return result;
  }

  async scoreMatch(userId: string, input: MatchInput): Promise<MatchScore> {
    if (this.mock) {
      return {
        overallScore: 75,
        breakdown: { skills: 80, experience: 70, location: 90, salary: 60, roleDirection: 85 },
        missingRequired: [],
        reasons: ['Mock mode: assumed match'],
        hardEligibilityFail: false,
      };
    }
    await this.budget!.checkBudget(userId);
    const result = await this.adapter!.scoreMatch(input);
    await this.budget!.recordUsage(userId, estimateTokens(input), 500, this.model);
    return result;
  }

  async generateCoverLetter(userId: string, input: CoverLetterInput): Promise<string> {
    if (this.mock) {
      return `Dear Hiring Manager,\n\nI am writing to express my interest in the ${input.job.title} position at ${input.job.employer}. [Mock cover letter — enable real AI to generate.]\n\nSincerely,\n${input.profile.fullName ?? 'Candidate'}`;
    }
    await this.budget!.checkBudget(userId);
    const result = await this.adapter!.generateCoverLetter(input);
    await this.budget!.recordUsage(
      userId,
      estimateTokens(input),
      estimateTokens(result),
      this.model,
    );
    return result;
  }
}
EOF

# ============================================================
# apps/api
# ============================================================

cat > apps/api/package.json <<'EOF'
{
  "name": "@shs/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "lint": "eslint \"src/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "test": "jest"
  },
  "dependencies": {
    "@nestjs/bullmq": "^11.0.0",
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/passport": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/swagger": "^11.0.0",
    "@prisma/client": "^6.1.0",
    "@shs/ai": "workspace:*",
    "@shs/data": "workspace:*",
    "@shs/provider-sdk": "workspace:*",
    "@shs/rules": "workspace:*",
    "@shs/shared": "workspace:*",
    "argon2": "^0.41.1",
    "bullmq": "^5.34.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "cookie-parser": "^1.4.7",
    "helmet": "^8.0.0",
    "ioredis": "^5.4.1",
    "mammoth": "^1.8.0",
    "multer": "^1.4.5-lts.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pdf-parse": "^1.1.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/multer": "^1.4.12",
    "@types/node": "^22.10.2",
    "@types/passport-jwt": "^4.0.1",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.2"
  }
}
EOF

cat > apps/api/tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "moduleResolution": "node",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
EOF

cat > apps/api/nest-cli.json <<'EOF'
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
EOF

cat > apps/api/src/main.ts <<'EOF'
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: config.get<string>('CORS_ORIGINS', '').split(',').filter(Boolean),
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SHS Job Pilot API')
    .setDescription('Job discovery, matching, and application automation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
EOF

cat > apps/api/src/app.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DataModule } from '@shs/data';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RulesModule } from './modules/rules/rules.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { HealthController } from './health.controller';

const isProd = process.env.NODE_ENV === 'production';
const testModules = isProd ? [] : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        maxRetriesPerRequest: null,
      },
    }),
    BullModule.registerQueue(
      { name: 'match-recent' },
      { name: 'prepare-application' },
      { name: 'application-submission' },
      { name: 'application-verification' },
    ),
    DataModule,
    AuthModule,
    ProfileModule,
    DocumentsModule,
    RulesModule,
    ApplicationsModule,
    ...testModules,
  ],
  controllers: [HealthController],
})
export class AppModule {}
EOF

cat > apps/api/src/health.controller.ts <<'EOF'
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '@shs/data';

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'api', ts: new Date().toISOString() };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', db: 'ok' };
    } catch (e) {
      return { status: 'not-ready', db: 'down', error: (e as Error).message };
    }
  }
}
EOF

# ============================================================
# Auth module
# ============================================================

cat > apps/api/src/modules/auth/dto.ts <<'EOF'
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}
EOF

cat > apps/api/src/modules/auth/jwt.strategy.ts <<'EOF'
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }
  async validate(payload: { sub: string; role: string }) {
    return { userId: payload.sub, role: payload.role };
  }
}
EOF

cat > apps/api/src/modules/auth/jwt-auth.guard.ts <<'EOF'
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
EOF

cat > apps/api/src/modules/auth/admin.guard.ts <<'EOF'
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException();
    return true;
  }
}
EOF

cat > apps/api/src/modules/auth/auth.service.ts <<'EOF'
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '@shs/data';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(email: string, password: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    return this.prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, role: true, createdAt: true },
    });
  }

  async login(email: string, password: string, userAgent?: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.jwt.sign(
      { sub: user.id, role: user.role },
      { expiresIn: this.config.get('JWT_ACCESS_TTL', '15m') },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    const ttlDays = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS', 30));

    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshHash,
        expiresAt: new Date(Date.now() + ttlDays * 86400_000),
        userAgent,
        ip,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async refresh(refreshToken: string) {
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    const session = await this.prisma.userSession.findUnique({
      where: { refreshHash },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const newRefreshToken = randomBytes(48).toString('base64url');
    const newRefreshHash = createHash('sha256').update(newRefreshToken).digest('hex');

    await this.prisma.userSession.create({
      data: {
        userId: session.userId,
        refreshHash: newRefreshHash,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
        ip: session.ip,
      },
    });

    const accessToken = this.jwt.sign(
      { sub: session.user.id, role: session.user.role },
      { expiresIn: this.config.get('JWT_ACCESS_TTL', '15m') },
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.prisma.userSession.updateMany({
      where: { refreshHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
EOF

cat > apps/api/src/modules/auth/auth.controller.ts <<'EOF'
import { Controller, Post, Body, Req, Res, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      req.headers['user-agent'],
      req.ip,
    );
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86400_000,
      path: '/api/v1/auth',
    });
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as any).cookies?.refreshToken;
    if (!token) throw new UnauthorizedException('No refresh token');
    const result = await this.auth.refresh(token);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86400_000,
      path: '/api/v1/auth',
    });
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as any).cookies?.refreshToken;
    if (token) await this.auth.logout(token).catch(() => {});
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  }
}
EOF

cat > apps/api/src/modules/auth/auth.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', '15m') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
EOF

# ============================================================
# Profile module
# ============================================================

cat > apps/api/src/modules/profile/dto.ts <<'EOF'
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl,
  Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NigerianState, EmploymentType } from '@prisma/client';

export class ProfilePatchDto {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsEnum(NigerianState) state?: NigerianState;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsBoolean() workAuthorized?: boolean;
  @IsOptional() @IsBoolean() needsSponsorship?: boolean;
  @IsOptional() @IsString() @MaxLength(120) currentRole?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) targetRoles?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(60) yearsExperience?: number;
  @IsOptional() @IsString() @MaxLength(120) noticePeriod?: string;
  @IsOptional() @IsString() @MaxLength(120) availability?: string;
  @IsOptional() @IsUrl() linkedinUrl?: string;
  @IsOptional() @IsUrl() githubUrl?: string;
  @IsOptional() @IsUrl() portfolioUrl?: string;
  @IsOptional() @IsUrl() websiteUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) summary?: string;
}

export class PreferencePatchDto {
  @IsOptional() @IsArray() @IsEnum(NigerianState, { each: true }) preferredStates?: NigerianState[];
  @IsOptional() @IsBoolean() remoteOnly?: boolean;
  @IsOptional() @IsBoolean() hybridAllowed?: boolean;
  @IsOptional() @IsBoolean() onsiteAllowed?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) salaryFloor?: number;
  @IsOptional() @IsString() @MaxLength(3) salaryCurrency?: string;
  @IsOptional() @IsArray() @IsEnum(EmploymentType, { each: true }) employmentTypes?: EmploymentType[];
  @IsOptional() @IsArray() @IsString({ each: true }) preferredIndustries?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) excludedIndustries?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) excludedCompanies?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) maxApplicationsPerDay?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) maxApplicationsPerWeek?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) minMatchScore?: number;
  @IsOptional() @IsBoolean() autoSubmitEnabled?: boolean;
  @IsOptional() @IsBoolean() coverLetterAutoGen?: boolean;
  @IsOptional() @IsBoolean() cvTailoringAllowed?: boolean;
  @IsOptional() @IsBoolean() reviewOnMissingRequired?: boolean;
}

export class SkillInputDto {
  @IsString() @MaxLength(60) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) level?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(60) yearsUsed?: number;
}

export class ExperienceInputDto {
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(200) employer!: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) highlights?: string[];
}

export class EducationInputDto {
  @IsString() @MaxLength(200) institution!: string;
  @IsOptional() @IsString() @MaxLength(120) degree?: string;
  @IsOptional() @IsString() @MaxLength(120) field?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
}

export class ApplyParsedDto {
  @IsString() documentId!: string;
  @IsOptional() @IsArray() @IsString({ each: true })
  acceptedSections?: ('contact' | 'skills' | 'experience' | 'education' | 'summary')[];
  @IsOptional() profile?: ProfilePatchDto;
  @IsOptional() @IsArray() skills?: SkillInputDto[];
  @IsOptional() @IsArray() experience?: ExperienceInputDto[];
  @IsOptional() @IsArray() education?: EducationInputDto[];
}

export class OnboardingStepDto {
  @IsString() @MaxLength(40) step!: string;
}
EOF

cat > apps/api/src/modules/profile/profile.service.ts <<'EOF'
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@shs/data';
import {
  ProfilePatchDto, PreferencePatchDto, SkillInputDto,
  ExperienceInputDto, EducationInputDto, ApplyParsedDto,
} from './dto';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async get(userId: string) {
    return this.prisma.userProfile.findUnique({
      where: { userId },
      include: {
        skills: { include: { skill: true } },
        experiences: { orderBy: { startDate: 'desc' } },
        education: { orderBy: { endDate: 'desc' } },
        preferences: true,
        languages: true,
      },
    });
  }

  async ensureExists(userId: string) {
    const existing = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.userProfile.create({
      data: {
        userId,
        targetRoles: [],
        onboardingStep: 'welcome',
        preferences: { create: {} },
      },
    });
  }

  async patch(userId: string, dto: ProfilePatchDto) {
    await this.ensureExists(userId);
    return this.prisma.userProfile.update({
      where: { userId },
      data: { ...dto, version: { increment: 1 } },
    });
  }

  async patchPreferences(userId: string, dto: PreferencePatchDto) {
    await this.ensureExists(userId);
    const profile = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.$transaction(async (tx) => {
      const prefs = await tx.careerPreference.upsert({
        where: { profileId: profile.id },
        create: { profileId: profile.id, ...dto },
        update: dto,
      });
      await tx.userProfile.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
      return prefs;
    });
  }

  async setSkills(userId: string, skills: SkillInputDto[]) {
    await this.ensureExists(userId);
    const profile = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.$transaction(async (tx) => {
      const skillRows = await Promise.all(
        skills.map((s) =>
          tx.skill.upsert({
            where: { name: s.name.trim() },
            create: { name: s.name.trim() },
            update: {},
          }),
        ),
      );
      await tx.userSkill.deleteMany({ where: { profileId: profile.id } });
      await tx.userSkill.createMany({
        data: skills.map((s, i) => ({
          profileId: profile.id,
          skillId: skillRows[i].id,
          level: s.level ?? null,
          yearsUsed: s.yearsUsed ?? null,
        })),
        skipDuplicates: true,
      });
      await tx.userProfile.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
      return tx.userSkill.findMany({
        where: { profileId: profile.id },
        include: { skill: true },
      });
    });
  }

  async setExperience(userId: string, entries: ExperienceInputDto[]) {
    await this.ensureExists(userId);
    const profile = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.$transaction(async (tx) => {
      await tx.experience.deleteMany({ where: { profileId: profile.id } });
      if (entries.length) {
        await tx.experience.createMany({
          data: entries.map((e) => ({
            profileId: profile.id,
            title: e.title,
            employer: e.employer,
            startDate: e.startDate ? new Date(e.startDate) : null,
            endDate: e.endDate ? new Date(e.endDate) : null,
            isCurrent: e.isCurrent ?? !e.endDate,
            description: e.description ?? null,
            highlights: e.highlights ?? [],
          })),
        });
      }
      await tx.userProfile.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
      return tx.experience.findMany({
        where: { profileId: profile.id },
        orderBy: { startDate: 'desc' },
      });
    });
  }

  async setEducation(userId: string, entries: EducationInputDto[]) {
    await this.ensureExists(userId);
    const profile = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.$transaction(async (tx) => {
      await tx.education.deleteMany({ where: { profileId: profile.id } });
      if (entries.length) {
        await tx.education.createMany({
          data: entries.map((e) => ({
            profileId: profile.id,
            institution: e.institution,
            degree: e.degree ?? null,
            field: e.field ?? null,
            startDate: e.startDate ? new Date(e.startDate) : null,
            endDate: e.endDate ? new Date(e.endDate) : null,
          })),
        });
      }
      await tx.userProfile.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
      return tx.education.findMany({ where: { profileId: profile.id } });
    });
  }

  async applyParsed(userId: string, dto: ApplyParsedDto) {
    const doc = await this.prisma.document.findUnique({ where: { id: dto.documentId } });
    if (!doc || doc.userId !== userId) throw new NotFoundException('Document not found');
    if (!doc.parsedData) throw new BadRequestException('Document has not been parsed yet');

    const parsed = doc.parsedData as any;
    const accepted = new Set(
      dto.acceptedSections ?? ['contact', 'skills', 'experience', 'education', 'summary'],
    );
    await this.ensureExists(userId);

    const profileFields: any = {};
    if (accepted.has('contact')) {
      if (parsed.fullName) profileFields.fullName = parsed.fullName;
      if (parsed.phone) profileFields.phone = parsed.phone;
    }
    if (accepted.has('summary') && parsed.summary) profileFields.summary = parsed.summary;

    await this.prisma.$transaction(async (tx) => {
      await tx.userProfile.update({
        where: { userId },
        data: { ...profileFields, ...(dto.profile ?? {}), version: { increment: 1 } },
      });

      if (accepted.has('skills')) {
        const skills = dto.skills ?? (parsed.skills ?? []).map((name: string) => ({ name }));
        if (skills.length) {
          const skillRows = await Promise.all(
            skills.map((s: any) =>
              tx.skill.upsert({
                where: { name: s.name },
                create: { name: s.name },
                update: {},
              }),
            ),
          );
          const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
          await tx.userSkill.deleteMany({ where: { profileId: profile.id } });
          await tx.userSkill.createMany({
            data: skills.map((s: any, i: number) => ({
              profileId: profile.id,
              skillId: skillRows[i].id,
              level: s.level ?? null,
              yearsUsed: s.yearsUsed ?? null,
            })),
          });
        }
      }

      if (accepted.has('experience')) {
        const entries = dto.experience ?? parsed.experience ?? [];
        if (entries.length) {
          const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
          await tx.experience.deleteMany({ where: { profileId: profile.id } });
          await tx.experience.createMany({
            data: entries.map((e: any) => ({
              profileId: profile.id,
              title: e.title,
              employer: e.employer,
              startDate: e.startDate ? new Date(e.startDate) : null,
              endDate: e.endDate ? new Date(e.endDate) : null,
              isCurrent: !e.endDate,
              highlights: e.highlights ?? [],
            })),
          });
        }
      }

      if (accepted.has('education')) {
        const entries = dto.education ?? parsed.education ?? [];
        if (entries.length) {
          const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
          await tx.education.deleteMany({ where: { profileId: profile.id } });
          await tx.education.createMany({
            data: entries.map((e: any) => ({
              profileId: profile.id,
              institution: e.institution,
              degree: e.degree ?? null,
              field: e.field ?? null,
            })),
          });
        }
      }
    });

    return this.get(userId);
  }

  async setOnboardingStep(userId: string, step: string) {
    await this.ensureExists(userId);
    return this.prisma.userProfile.update({
      where: { userId },
      data: { onboardingStep: step },
    });
  }

  async completeOnboarding(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: { preferences: true, skills: true },
    });
    if (!profile) throw new BadRequestException('Profile not created');
    if (!profile.fullName) throw new BadRequestException('Full name is required');
    if (!profile.targetRoles?.length) throw new BadRequestException('At least one target role is required');
    if (!profile.skills?.length) throw new BadRequestException('At least one skill is required');
    if (!profile.preferences) throw new BadRequestException('Preferences are required');

    const ruleCount = await this.prisma.applicationRule.count({
      where: { userId, isActive: true },
    });
    if (ruleCount === 0) throw new BadRequestException('An active rule is required');

    return this.prisma.userProfile.update({
      where: { userId },
      data: {
        onboardingCompletedAt: new Date(),
        onboardingStep: 'done',
      },
    });
  }
}
EOF

cat > apps/api/src/modules/profile/profile.controller.ts <<'EOF'
import {
  Controller, Get, Post, Patch, Body, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfileService } from './profile.service';
import {
  ProfilePatchDto, PreferencePatchDto, SkillInputDto, ExperienceInputDto,
  EducationInputDto, ApplyParsedDto, OnboardingStepDto,
} from './dto';

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'profile', version: '1' })
export class ProfileController {
  constructor(private profile: ProfileService) {}

  @Get()
  async get(@Req() req: any) {
    await this.profile.ensureExists(req.user.userId);
    return this.profile.get(req.user.userId);
  }

  @Patch()
  patch(@Req() req: any, @Body() dto: ProfilePatchDto) {
    return this.profile.patch(req.user.userId, dto);
  }

  @Patch('preferences')
  patchPreferences(@Req() req: any, @Body() dto: PreferencePatchDto) {
    return this.profile.patchPreferences(req.user.userId, dto);
  }

  @Post('skills')
  setSkills(@Req() req: any, @Body() body: { skills: SkillInputDto[] }) {
    return this.profile.setSkills(req.user.userId, body.skills);
  }

  @Post('experience')
  setExperience(@Req() req: any, @Body() body: { entries: ExperienceInputDto[] }) {
    return this.profile.setExperience(req.user.userId, body.entries);
  }

  @Post('education')
  setEducation(@Req() req: any, @Body() body: { entries: EducationInputDto[] }) {
    return this.profile.setEducation(req.user.userId, body.entries);
  }

  @Post('apply-parsed')
  applyParsed(@Req() req: any, @Body() dto: ApplyParsedDto) {
    return this.profile.applyParsed(req.user.userId, dto);
  }

  @Post('onboarding-step')
  setStep(@Req() req: any, @Body() dto: OnboardingStepDto) {
    return this.profile.setOnboardingStep(req.user.userId, dto.step);
  }

  @Post('complete-onboarding')
  complete(@Req() req: any) {
    return this.profile.completeOnboarding(req.user.userId);
  }
}
EOF

cat > apps/api/src/modules/profile/profile.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
EOF

# ============================================================
# Documents module
# ============================================================

cat > apps/api/src/modules/documents/storage.service.ts <<'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, extname } from 'path';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly basePath: string;
  private readonly maxSizeBytes: number;

  constructor(config: ConfigService) {
    this.basePath = config.getOrThrow<string>('DOCUMENT_STORAGE_PATH');
    this.maxSizeBytes = Number(config.get('MAX_UPLOAD_SIZE_MB', 10)) * 1024 * 1024;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true, mode: 0o750 });
  }

  validate(file: Express.Multer.File): void {
    if (file.size > this.maxSizeBytes) {
      throw new Error(`File exceeds ${this.maxSizeBytes} bytes`);
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new Error(`Unsupported MIME type: ${file.mimetype}`);
    }
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported extension: ${ext}`);
    }
  }

  async store(buffer: Buffer, userId: string, originalName: string) {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = extname(originalName).toLowerCase();
    const storageKey = `${userId}/${randomUUID()}${ext}`;
    const absolutePath = join(this.basePath, storageKey);

    await fs.mkdir(join(this.basePath, userId), { recursive: true, mode: 0o750 });
    await fs.writeFile(absolutePath, buffer, { mode: 0o640 });

    return { storageKey, sha256, absolutePath };
  }

  async read(storageKey: string): Promise<Buffer> {
    const absolutePath = join(this.basePath, storageKey);
    if (!absolutePath.startsWith(this.basePath)) {
      throw new Error('Invalid storage key');
    }
    return fs.readFile(absolutePath);
  }

  async delete(storageKey: string): Promise<void> {
    const absolutePath = join(this.basePath, storageKey);
    if (!absolutePath.startsWith(this.basePath)) throw new Error('Invalid storage key');
    await fs.unlink(absolutePath).catch(() => {});
  }

  absolutePath(storageKey: string): string {
    const p = join(this.basePath, storageKey);
    if (!p.startsWith(this.basePath)) throw new Error('Invalid storage key');
    return p;
  }
}
EOF

cat > apps/api/src/modules/documents/extraction.service.ts <<'EOF'
import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth');

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  async extract(absolutePath: string, mimeType: string): Promise<{ text: string; needsOcr: boolean }> {
    const buffer = await fs.readFile(absolutePath);

    if (mimeType === 'application/pdf') {
      try {
        const result = await pdfParse(buffer);
        const text = (result.text ?? '').trim();
        return { text, needsOcr: text.length < 50 };
      } catch (e) {
        this.logger.warn(`PDF parse failed: ${(e as Error).message}`);
        return { text: '', needsOcr: true };
      }
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return { text: (result.value ?? '').trim(), needsOcr: false };
    }

    throw new Error(`Unsupported MIME type for extraction: ${mimeType}`);
  }
}
EOF

cat > apps/api/src/modules/documents/documents.service.ts <<'EOF'
import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService, AiService } from '@shs/data';
import { StorageService } from './storage.service';
import { ExtractionService } from './extraction.service';
import { DocumentKind } from '@prisma/client';
import { createHash } from 'crypto';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private extraction: ExtractionService,
    private ai: AiService,
  ) {}

  async upload(userId: string, file: Express.Multer.File) {
    await this.storage.ensureReady();
    this.storage.validate(file);

    const { storageKey, sha256, absolutePath } = await this.storage.store(
      file.buffer,
      userId,
      file.originalname,
    );

    const existing = await this.prisma.document.findFirst({
      where: { userId, sha256, deletedAt: null },
    });
    if (existing) {
      await this.storage.delete(storageKey);
      return existing;
    }

    const doc = await this.prisma.document.create({
      data: {
        userId,
        kind: 'CV' as DocumentKind,
        originalName: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256,
        fileHash: createHash('sha256').update(storageKey).digest('hex'),
        extractionStatus: 'PENDING',
      },
    });

    if (file.size < 5 * 1024 * 1024) {
      await this.extractInline(doc.id, absolutePath, file.mimetype);
    }

    return this.prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
  }

  private async extractInline(documentId: string, absolutePath: string, mimeType: string) {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { extractionStatus: 'PROCESSING' },
    });
    try {
      const { text, needsOcr } = await this.extraction.extract(absolutePath, mimeType);
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          extractedText: text,
          extractionStatus: needsOcr ? 'NEEDS_OCR' : 'SUCCESS',
          extractedAt: new Date(),
        },
      });
    } catch (e) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          extractionStatus: 'FAILED',
          extractionError: (e as Error).message,
        },
      });
    }
  }

  async list(userId: string) {
    return this.prisma.document.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, kind: true, originalName: true, mimeType: true,
        sizeBytes: true, extractionStatus: true, createdAt: true,
        parsedData: true,
      },
    });
  }

  async getForDownload(userId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.deletedAt) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException();
    const buffer = await this.storage.read(doc.storageKey);
    return { buffer, filename: doc.originalName, mimeType: doc.mimeType };
  }

  async parseCv(userId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.deletedAt) throw new NotFoundException();
    if (doc.userId !== userId) throw new ForbiddenException();

    if (doc.extractionStatus === 'NEEDS_OCR') {
      throw new BadRequestException(
        'This CV appears to be a scanned image. Please paste the text manually or upload a text-based PDF.',
      );
    }
    if (doc.extractionStatus !== 'SUCCESS' || !doc.extractedText) {
      throw new BadRequestException('CV text has not been extracted yet');
    }

    const parsed = await this.ai.parseCv(userId, doc.extractedText);
    await this.prisma.document.update({
      where: { id: documentId },
      data: { parsedData: parsed as any },
    });
    return { documentId, parsed };
  }

  async softDelete(userId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.deletedAt) throw new NotFoundException();
    if (doc.userId !== userId) throw new ForbiddenException();
    await this.prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
  }
}
EOF

cat > apps/api/src/modules/documents/documents.controller.ts <<'EOF'
import {
  Controller, Post, Get, Delete, Param, UploadedFile,
  UseInterceptors, UseGuards, Req, BadRequestException, Res, HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('No file provided');
    return this.docs.upload(req.user.userId, file);
  }

  @Get()
  list(@Req() req: any) {
    return this.docs.list(req.user.userId);
  }

  @Post(':id/parse')
  parse(@Param('id') id: string, @Req() req: any) {
    return this.docs.parseCv(req.user.userId, id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const { buffer, filename, mimeType } = await this.docs.getForDownload(req.user.userId, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.docs.softDelete(req.user.userId, id);
  }
}
EOF

cat > apps/api/src/modules/documents/documents.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { StorageService } from './storage.service';
import { ExtractionService } from './extraction.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, StorageService, ExtractionService],
  exports: [DocumentsService, StorageService],
})
export class DocumentsModule {}
EOF

# ============================================================
# Rules module (HTTP-facing; engine lives in @shs/rules)
# ============================================================

cat > apps/api/src/modules/rules/rules.service.ts <<'EOF'
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@shs/data';
import {
  RuleConditionsSchema,
  evaluateRule,
  type EvalContext,
  type RuleConditions,
  type NigerianState,
  type WorkArrangement,
  type EmploymentType,
} from '@shs/rules';

const SIMULATION_BATCH_SIZE = 500;
const SIMULATION_MAX_JOBS = 20_000;

@Injectable()
export class RulesService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.applicationRule.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getActive(userId: string) {
    return this.prisma.applicationRule.findFirst({
      where: { userId, isActive: true },
    });
  }

  async create(userId: string, name: string, conditions: unknown) {
    const parsed = RuleConditionsSchema.parse(conditions);
    return this.prisma.$transaction(async (tx) => {
      await tx.applicationRule.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });
      return tx.applicationRule.create({
        data: {
          userId,
          name,
          conditions: parsed as any,
          isActive: true,
          version: 1,
        },
      });
    });
  }

  async update(
    userId: string,
    ruleId: string,
    patch: { name?: string; conditions?: unknown; isActive?: boolean },
  ) {
    const rule = await this.prisma.applicationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException();
    if (rule.userId !== userId) throw new ForbiddenException();

    const data: any = { version: { increment: 1 } };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.conditions !== undefined) {
      data.conditions = RuleConditionsSchema.parse(patch.conditions) as any;
    }

    return this.prisma.$transaction(async (tx) => {
      if (patch.isActive === true) {
        await tx.applicationRule.updateMany({
          where: { userId, id: { not: ruleId }, isActive: true },
          data: { isActive: false },
        });
      }
      return tx.applicationRule.update({ where: { id: ruleId }, data });
    });
  }

  async remove(userId: string, ruleId: string) {
    const rule = await this.prisma.applicationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException();
    if (rule.userId !== userId) throw new ForbiddenException();
    await this.prisma.applicationRule.delete({ where: { id: ruleId } });
  }

  async simulate(userId: string, conditions: unknown) {
    const parsed = RuleConditionsSchema.parse(conditions);
    const profileCtx = await this.loadProfileContext(userId);
    const now = new Date();

    const summary: any = {
      evaluated: 0, eligible: 0, review: 0, ineligible: 0,
      hardFailureCounts: {}, softFailureCounts: {},
      sampleIneligible: [], sampleEligible: [],
    };

    let cursor: string | undefined;
    while (summary.evaluated < SIMULATION_MAX_JOBS) {
      const jobs = await this.prisma.job.findMany({
        where: { status: 'ACTIVE' },
        take: SIMULATION_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });
      if (jobs.length === 0) break;
      cursor = jobs[jobs.length - 1].id;

      for (const job of jobs) {
        const ctx = this.buildContext(job, profileCtx, now);
        const result = evaluateRule(parsed, ctx);
        summary.evaluated++;
        if (result.outcome === 'ELIGIBLE') summary.eligible++;
        else if (result.outcome === 'REVIEW') summary.review++;
        else summary.ineligible++;

        for (const f of result.hardFailures) {
          summary.hardFailureCounts[f.conditionType] =
            (summary.hardFailureCounts[f.conditionType] ?? 0) + 1;
        }
        if (result.outcome === 'INELIGIBLE' && summary.sampleIneligible.length < 10) {
          summary.sampleIneligible.push({ jobId: job.id, title: job.title, reasons: result.reasons });
        }
        if (result.outcome === 'ELIGIBLE' && summary.sampleEligible.length < 10) {
          summary.sampleEligible.push({ jobId: job.id, title: job.title, score: null });
        }
      }

      if (jobs.length < SIMULATION_BATCH_SIZE) break;
    }

    return summary;
  }

  private async loadProfileContext(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: { skills: { include: { skill: true } }, preferences: true },
    });
    if (!profile) throw new BadRequestException('Profile not set up');

    return {
      targetRoles: profile.targetRoles,
      yearsExperience: profile.yearsExperience,
      skills: profile.skills.map((s) => s.skill.name),
      preferredStates: (profile.preferences?.preferredStates ?? []) as NigerianState[],
      remoteOnly: profile.preferences?.remoteOnly ?? false,
      salaryFloor: profile.preferences?.salaryFloor ?? null,
      salaryCurrency: profile.preferences?.salaryCurrency ?? 'NGN',
      excludedCompanies: profile.preferences?.excludedCompanies ?? [],
      employmentTypes: (profile.preferences?.employmentTypes ?? []) as EmploymentType[],
    };
  }

  private buildContext(job: any, profile: EvalContext['profile'], now: Date): EvalContext {
    return {
      job: {
        title: job.title,
        description: job.description,
        employer: job.employer,
        state: job.state,
        workArrangement: job.workArrangement as WorkArrangement,
        employmentType: job.employmentType as EmploymentType,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        requiredSkills: job.requiredSkills,
        preferredSkills: job.preferredSkills,
        experienceYears: job.experienceYears,
        seniority: job.seniority,
        publishedAt: job.publishedAt,
      },
      profile,
      now,
    };
  }
}
EOF

cat > apps/api/src/modules/rules/rules.controller.ts <<'EOF'
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RulesService } from './rules.service';

@ApiTags('rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'rules', version: '1' })
export class RulesController {
  constructor(private rules: RulesService) {}

  @Get()
  list(@Req() req: any) {
    return this.rules.list(req.user.userId);
  }

  @Get('active')
  active(@Req() req: any) {
    return this.rules.getActive(req.user.userId);
  }

  @Post()
  create(@Req() req: any, @Body() body: { name: string; conditions: unknown }) {
    return this.rules.create(req.user.userId, body.name, body.conditions);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.rules.update(req.user.userId, id, body);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.rules.remove(req.user.userId, id);
  }

  @Post('simulate')
  simulate(@Req() req: any, @Body() body: { conditions: unknown }) {
    return this.rules.simulate(req.user.userId, body.conditions);
  }
}
EOF

cat > apps/api/src/modules/rules/rules.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

@Module({
  controllers: [RulesController],
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}
EOF

# ============================================================
# Applications module
# ============================================================

cat > apps/api/src/modules/applications/applications.controller.ts <<'EOF'
import {
  Controller, Get, Post, Param, Body, Query, Req, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApplicationsService, TransitionsService } from '@shs/data';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplicationState } from '@shs/shared';

@ApiTags('applications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'applications', version: '1' })
export class ApplicationsController {
  constructor(
    private applications: ApplicationsService,
    private transitions: TransitionsService,
    @InjectQueue('application-submission') private submissionQueue: Queue,
  ) {}

  @Get()
  list(@Req() req: any, @Query('state') state?: ApplicationState) {
    return this.applications.list(req.user.userId, state);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.applications.get(req.user.userId, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Req() req: any, @Param('id') id: string) {
    const result = await this.applications.approve(req.user.userId, id);
    // Wake the submission worker immediately.
    await this.submissionQueue.add(
      'submit',
      { applicationId: id },
      { attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
    );
    return result;
  }

  @Post(':id/skip')
  @HttpCode(200)
  skip(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.applications.skip(req.user.userId, id, body?.reason);
  }

  @Post(':id/verify')
  @HttpCode(200)
  async verify(@Req() req: any, @Param('id') id: string) {
    // User-triggered verification: emits an event, doesn't re-submit.
    const app = await this.applications.get(req.user.userId, id);
    if (app.state !== 'SUBMITTED' && app.state !== 'UNKNOWN_OUTCOME') {
      return { skipped: `state=${app.state}` };
    }
    return { queued: true, state: app.state };
  }
}
EOF

cat > apps/api/src/modules/applications/applications.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';

@Module({
  controllers: [ApplicationsController],
})
export class ApplicationsModule {}
EOF

echo ""
echo "✓ Part 3 complete."
echo ""
echo "Created:"
find packages/data apps/api -type f | sort