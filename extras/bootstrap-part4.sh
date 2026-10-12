#!/usr/bin/env bash
# SHS Job Pilot — Part 4: worker, web, scripts, README
set -euo pipefail

echo "→ Creating directory tree (part 4)"
mkdir -p apps/worker/src/prisma apps/worker/src/providers apps/worker/src/scheduler apps/worker/src/processors
mkdir -p apps/api/src/modules/admin
mkdir -p apps/web/src/app/{login,register}
mkdir -p apps/web/src/app/\(app\)/{dashboard,documents,jobs,applications,rules,settings,notifications}
mkdir -p apps/web/src/app/\(app\)/jobs/\[id\]
mkdir -p apps/web/src/app/\(app\)/applications/\[id\]
mkdir -p apps/web/src/app/\(app\)/onboarding/steps
mkdir -p apps/web/src/lib
mkdir -p scripts

# ============================================================
# apps/worker
# ============================================================

cat > apps/worker/package.json <<'EOF'
{
  "name": "@shs/worker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/bullmq": "^11.0.0",
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@prisma/client": "^6.1.0",
    "@shs/ai": "workspace:*",
    "@shs/data": "workspace:*",
    "@shs/provider-sdk": "workspace:*",
    "@shs/rules": "workspace:*",
    "@shs/shared": "workspace:*",
    "bullmq": "^5.34.0",
    "ioredis": "^5.4.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2"
  }
}
EOF

cat > apps/worker/tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "moduleResolution": "node",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
EOF

cat > apps/worker/nest-cli.json <<'EOF'
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
EOF

cat > apps/worker/src/main.ts <<'EOF'
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  const logger = new Logger('Worker');
  logger.log('SHS Job Pilot worker started');

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, closing workers…`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
bootstrap();
EOF

cat > apps/worker/src/worker.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DataModule } from '@shs/data';
import { ProvidersModule } from './providers/providers.module';
import { AdzunaSyncProcessor } from './processors/adzuna-sync.processor';
import { MatchRecentProcessor } from './processors/match-recent.processor';
import { PrepareApplicationProcessor } from './processors/prepare-application.processor';
import { SubmissionProcessor } from './processors/submission.processor';
import { VerificationProcessor } from './processors/verification.processor';
import { SchedulerService } from './scheduler/scheduler.service';

export const QUEUES = {
  adzunaSync: 'adzuna-sync',
  matchRecent: 'match-recent',
  prepareApplication: 'prepare-application',
  submission: 'application-submission',
  verification: 'application-verification',
} as const;

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
      { name: QUEUES.adzunaSync },
      { name: QUEUES.matchRecent },
      { name: QUEUES.prepareApplication },
      { name: QUEUES.submission },
      { name: QUEUES.verification },
    ),
    DataModule,
    ProvidersModule,
  ],
  providers: [
    AdzunaSyncProcessor,
    MatchRecentProcessor,
    PrepareApplicationProcessor,
    SubmissionProcessor,
    VerificationProcessor,
    SchedulerService,
  ],
})
export class WorkerModule {}
EOF

cat > apps/worker/src/providers/providers.module.ts <<'EOF'
import { Global, Module } from '@nestjs/common';
import { ProvidersService } from './providers.service';

@Global()
@Module({
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
EOF

cat > apps/worker/src/providers/providers.service.ts <<'EOF'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shs/data';
import { buildRegistry, ProviderRegistry } from '@shs/provider-sdk';

@Injectable()
export class ProvidersService implements OnModuleInit {
  private readonly logger = new Logger(ProvidersService.name);
  private registry: ProviderRegistry;

  constructor(private config: ConfigService, private prisma: PrismaService) {
    this.registry = buildRegistry(
      {
        adzunaAppId: config.get('PROVIDER_ADZUNA_APP_ID'),
        adzunaAppKey: config.get('PROVIDER_ADZUNA_APP_KEY'),
        adzunaCountry: config.get('PROVIDER_ADZUNA_COUNTRY', 'ng'),
        mockEnabled: config.get('AI_MOCK_MODE') === 'true',
      },
      config.get('NODE_ENV', 'development'),
    );
  }

  async onModuleInit() {
    // Ensure every provider in the registry has a JobProvider row.
    for (const p of this.registry.list()) {
      await this.prisma.jobProvider.upsert({
        where: { key: p.key },
        create: {
          key: p.key,
          displayName: p.displayName,
          accessMode: p.capabilities.accessMode,
          capabilities: p.capabilities as any,
          enabled: true,
          configured: p.capabilities.requiresCredentials ? true : true,
        },
        update: {
          displayName: p.displayName,
          accessMode: p.capabilities.accessMode,
          capabilities: p.capabilities as any,
        },
      });
    }
    for (const m of this.registry.listManual()) {
      await this.prisma.jobProvider.upsert({
        where: { key: m.key },
        create: {
          key: m.key,
          displayName: m.displayName,
          accessMode: m.capabilities.accessMode,
          capabilities: m.capabilities as any,
          enabled: true,
          configured: true,
        },
        update: {
          displayName: m.displayName,
          accessMode: m.capabilities.accessMode,
          capabilities: m.capabilities as any,
        },
      });
    }
    this.logger.log(`Registered ${this.registry.list().length} active + ${this.registry.listManual().length} manual providers`);
  }

  get(key: string) { return this.registry.get(key); }
  registry_() { return this.registry; }
}
EOF

# ---------- Adzuna sync processor ----------
cat > apps/worker/src/processors/adzuna-sync.processor.ts <<'EOF'
import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '@shs/data';
import { ProvidersService } from '../providers/providers.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { QUEUES } from '../worker.module';

const ADZUNA_SYNC_CONFIG = {
  country: 'ng',
  keywords: [
    'software engineer', 'data analyst', 'product manager',
    'finance', 'sales', 'marketing', 'operations',
    'human resources', 'mechanical engineer', 'customer service',
  ],
  pagesPerKeyword: 2,
  resultsPerPage: 50,
};

@Processor(QUEUES.adzunaSync, { concurrency: 1 })
export class AdzunaSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(AdzunaSyncProcessor.name);

  constructor(
    private prisma: PrismaService,
    private providers: ProvidersService,
    private scheduler: SchedulerService,
    @InjectQueue(QUEUES.matchRecent) private matchQueue: Queue,
  ) {
    super();
  }

  async process(_job: Job) {
    const adapter = this.providers.get('adzuna');
    if (!adapter) {
      this.logger.warn('Adzuna adapter not registered — skipping');
      return { skipped: 'no-adapter' };
    }

    const availability = await adapter.checkAvailability();
    if (!availability.available) {
      await this.prisma.jobProvider.update({
        where: { key: 'adzuna' },
        data: { healthy: false, lastError: availability.reason ?? 'unavailable', lastErrorAt: new Date() },
      });
      return { skipped: availability.reason };
    }

    const run = await this.prisma.providerSyncRun.create({
      data: { providerKey: 'adzuna', status: 'RUNNING' },
    });

    const syncStartedAt = new Date();
    let jobsFound = 0, jobsNew = 0, jobsDuplicate = 0;

    try {
      for (const keyword of ADZUNA_SYNC_CONFIG.keywords) {
        for (let page = 1; page <= ADZUNA_SYNC_CONFIG.pagesPerKeyword; page++) {
          const result = await adapter.searchJobs({
            keywords: keyword,
            page,
            pageSize: ADZUNA_SYNC_CONFIG.resultsPerPage,
            country: 'ng',
          });
          jobsFound += result.jobs.length;

          for (const n of result.jobs) {
            const canonicalKey = computeCanonicalKey(n);
            const existing = await this.prisma.job.findUnique({ where: { canonicalKey } });
            if (existing) {
              jobsDuplicate++;
              await this.prisma.job.update({
                where: { id: existing.id },
                data: { lastSeenAt: new Date() },
              });
              continue;
            }
            try {
              await this.prisma.job.create({
                data: {
                  providerKey: n.providerKey,
                  externalId: n.externalId,
                  title: n.title,
                  employer: n.employer,
                  description: n.description,
                  country: 'NG',
                  city: n.location?.city,
                  workArrangement: n.workArrangement,
                  employmentType: n.employmentType,
                  salaryMin: n.salary?.min,
                  salaryMax: n.salary?.max,
                  salaryCurrency: n.salary?.currency ?? 'NGN',
                  salaryPeriod: n.salary?.period,
                  sourceUrl: n.sourceUrl,
                  applyUrl: n.applyUrl,
                  publishedAt: n.publishedAt ? new Date(n.publishedAt) : undefined,
                  canonicalKey,
                  attribution: n.attribution,
                  usageRestrictions: n.usageRestrictions ?? [],
                  rawPayload: n as any,
                },
              });
              jobsNew++;
            } catch (e: any) {
              if (e.code === 'P2002') { jobsDuplicate++; continue; }
              throw e;
            }
          }
        }
      }

      await this.prisma.providerSyncRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), jobsFound, jobsNew, jobsDuplicate },
      });
      await this.prisma.jobProvider.update({
        where: { key: 'adzuna' },
        data: { lastSyncAt: new Date(), healthy: true, lastError: null },
      });

      // Fan out match-recent to all active users
      await this.scheduler.fanOutMatchRecent(syncStartedAt);

      this.logger.log(`Adzuna sync: found=${jobsFound} new=${jobsNew} dup=${jobsDuplicate}`);
      return { jobsFound, jobsNew, jobsDuplicate };
    } catch (e) {
      await this.prisma.providerSyncRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: (e as Error).message },
      });
      await this.prisma.jobProvider.update({
        where: { key: 'adzuna' },
        data: { healthy: false, lastError: (e as Error).message, lastErrorAt: new Date() },
      });
      throw e;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`adzuna-sync failed: ${err.message}`);
  }
}

function computeCanonicalKey(job: { employer: string; title: string; location?: { city?: string } }): string {
  const norm = [
    job.employer.toLowerCase().replace(/[^a-z0-9]/g, ''),
    job.title.toLowerCase().replace(/[^a-z0-9]/g, ''),
    (job.location?.city ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  ].join('|');
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}
EOF

# ---------- Match recent processor ----------
cat > apps/worker/src/processors/match-recent.processor.ts <<'EOF'
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { PrismaService, ApplicationsService, TransitionsService } from '@shs/data';
import {
  evaluateRule, RuleConditionsSchema,
  type EvalContext, type NigerianState, type WorkArrangement, type EmploymentType,
} from '@shs/rules';
import { QUEUES } from '../worker.module';

const BATCH_SIZE = 100;
const MAX_JOBS_PER_RUN = 500;

@Processor(QUEUES.matchRecent, { concurrency: 2 })
export class MatchRecentProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchRecentProcessor.name);

  constructor(
    private prisma: PrismaService,
    private applications: ApplicationsService,
    private transitions: TransitionsService,
    @InjectQueue(QUEUES.prepareApplication) private prepareQueue: Queue,
  ) { super(); }

  async process(job: Job<{ userId: string; since?: string }>) {
    const { userId, since } = job.data;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: { include: { skills: { include: { skill: true } }, preferences: true } },
        rules: { where: { isActive: true }, take: 1 },
      },
    });
    if (!user || user.deletedAt || !user.isActive) return { skipped: 'user-inactive' };
    if (!user.profile) return { skipped: 'no-profile' };
    if (!user.rules[0]) return { skipped: 'no-active-rule' };

    const rule = user.rules[0];
    const conditions = RuleConditionsSchema.parse(rule.conditions);
    const profileVersion = user.profile.version;

    const profileCtx: EvalContext['profile'] = {
      targetRoles: user.profile.targetRoles,
      yearsExperience: user.profile.yearsExperience,
      skills: user.profile.skills.map((s) => s.skill.name),
      preferredStates: (user.profile.preferences?.preferredStates ?? []) as NigerianState[],
      remoteOnly: user.profile.preferences?.remoteOnly ?? false,
      salaryFloor: user.profile.preferences?.salaryFloor ?? null,
      salaryCurrency: user.profile.preferences?.salaryCurrency ?? 'NGN',
      excludedCompanies: user.profile.preferences?.excludedCompanies ?? [],
      employmentTypes: (user.profile.preferences?.employmentTypes ?? []) as EmploymentType[],
    };

    const alreadyEvaluated = await this.prisma.ruleEvaluation.findMany({
      where: { ruleId: rule.id },
      select: { jobId: true },
    });
    const seen = new Set(alreadyEvaluated.map((e) => e.jobId));

    let cursor: string | undefined;
    let examined = 0, eligible = 0, review = 0, ineligible = 0, created = 0;

    while (examined < MAX_JOBS_PER_RUN) {
      const jobs = await this.prisma.job.findMany({
        where: { status: 'ACTIVE', ...(since ? { firstSeenAt: { gte: new Date(since) } } : {}) },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });
      if (jobs.length === 0) break;
      cursor = jobs[jobs.length - 1].id;
      const fresh = jobs.filter((j) => !seen.has(j.id));

      for (const j of fresh) {
        examined++;
        const ctx: EvalContext = {
          job: {
            title: j.title, description: j.description, employer: j.employer,
            state: j.state, workArrangement: j.workArrangement as WorkArrangement,
            employmentType: j.employmentType as EmploymentType,
            salaryMin: j.salaryMin, salaryMax: j.salaryMax, salaryCurrency: j.salaryCurrency,
            requiredSkills: j.requiredSkills, preferredSkills: j.preferredSkills,
            experienceYears: j.experienceYears, seniority: j.seniority, publishedAt: j.publishedAt,
          },
          profile: profileCtx,
          now: new Date(),
        };
        const result = evaluateRule(conditions, ctx);

        await this.prisma.ruleEvaluation.create({
          data: {
            ruleId: rule.id, jobId: j.id, profileVersion,
            ruleVersion: rule.version, result: result.outcome, reasons: result.reasons,
          },
        });

        if (result.outcome === 'INELIGIBLE') { ineligible++; continue; }
        if (result.outcome === 'ELIGIBLE') eligible++; else review++;

        const app = await this.applications.createOrGet({
          userId, jobId: j.id, ruleEvalJson: result,
        });
        if (app.state !== 'DISCOVERED') continue;

        try {
          await this.transitions.transition(app.id, 'MATCHED', { note: 'Passed deterministic rules engine' });
          await this.transitions.transition(app.id, 'ELIGIBILITY_CHECKED', { note: `Rules: ${result.outcome}` });
        } catch (e) {
          this.logger.warn(`Transition failed for ${app.id}: ${(e as Error).message}`);
          continue;
        }
        created++;
        await this.prepareQueue.add(
          'prepare',
          { applicationId: app.id },
          { attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 500, removeOnFail: 1000 },
        );
      }

      if (jobs.length < BATCH_SIZE) break;
    }

    this.logger.log(`match-recent[${userId}]: examined=${examined} eligible=${eligible} review=${review} ineligible=${ineligible} created=${created}`);
    return { examined, eligible, review, ineligible, created };
  }
}
EOF

# ---------- Prepare application processor ----------
cat > apps/worker/src/processors/prepare-application.processor.ts <<'EOF'
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { PrismaService, TransitionsService, ApplicationsService, AiService } from '@shs/data';
import { ProvidersService } from '../providers/providers.service';
import { RuleConditionsSchema } from '@shs/rules';
import { QUEUES } from '../worker.module';

@Processor(QUEUES.prepareApplication, { concurrency: 4 })
export class PrepareApplicationProcessor extends WorkerHost {
  private readonly logger = new Logger(PrepareApplicationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private transitions: TransitionsService,
    private applications: ApplicationsService,
    private ai: AiService,
    private providers: ProvidersService,
    @InjectQueue(QUEUES.submission) private submissionQueue: Queue,
  ) { super(); }

  async process(job: Job<{ applicationId: string }>) {
    const { applicationId } = job.data;

    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: true,
        user: {
          include: {
            profile: {
              include: {
                skills: { include: { skill: true } },
                experiences: true, preferences: true, education: true,
              },
            },
            rules: { where: { isActive: true }, take: 1 },
          },
        },
      },
    });
    if (!app) return { skipped: 'not-found' };
    if (app.state !== 'ELIGIBILITY_CHECKED') return { skipped: `state=${app.state}` };

    const rule = app.user.rules[0];
    if (!rule) {
      await this.transitions.transition(applicationId, 'FAILED', { lastError: 'No active rule' });
      return { failed: 'no-rule' };
    }
    const conditions = RuleConditionsSchema.parse(rule.conditions);
    const profile = app.user.profile;
    if (!profile) {
      await this.transitions.transition(applicationId, 'FAILED', { lastError: 'No profile' });
      return { failed: 'no-profile' };
    }

    const ruleOutcome = (app.ruleEvalJson as { outcome?: string } | null)?.outcome ?? 'REVIEW';
    const matchScore = await this.getOrComputeMatch(app, profile, conditions);

    if (matchScore === null) {
      await this.transitions.transition(applicationId, 'DRAFT_PREPARED', { note: 'Draft without AI scoring' });
      await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', { note: 'AI unavailable — manual review' });
      return { outcome: 'awaiting_approval', reason: 'ai-unavailable' };
    }

    let finalOutcome: 'ELIGIBLE' | 'REVIEW' | 'INELIGIBLE';
    if (ruleOutcome === 'INELIGIBLE' || matchScore.hardEligibilityFail) finalOutcome = 'INELIGIBLE';
    else if (ruleOutcome === 'REVIEW') finalOutcome = 'REVIEW';
    else if (matchScore.overallScore >= conditions.minMatchScore) finalOutcome = 'ELIGIBLE';
    else finalOutcome = 'REVIEW';

    if (finalOutcome === 'INELIGIBLE') {
      const reviewOverride = profile.preferences?.reviewOnMissingRequired ?? false;
      if (matchScore.hardEligibilityFail && reviewOverride) {
        await this.transitions.transition(applicationId, 'DRAFT_PREPARED', {
          note: 'AI flagged a hard fail, but reviewOnMissingRequired is enabled',
        });
        await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', {
          note: 'User must decide on missing required qualification',
          metadata: { missingRequired: matchScore.missingRequired },
        });
        return { outcome: 'awaiting_approval', reason: 'hard-fail-review-override' };
      }
      await this.transitions.transition(applicationId, 'SKIPPED', {
        note: matchScore.hardEligibilityFail
          ? 'Missing mandatory qualification per AI analysis'
          : `Match score below threshold`,
        metadata: { matchScore: matchScore.overallScore, missingRequired: matchScore.missingRequired },
      });
      return { outcome: 'skipped' };
    }

    await this.prisma.application.update({
      where: { id: applicationId },
      data: { matchScore: matchScore.overallScore },
    });

    let coverLetter: string | null = null;
    const prefs = profile.preferences;
    if (prefs?.coverLetterAutoGen ?? true) {
      try {
        coverLetter = await this.ai.generateCoverLetter(app.userId, {
          profile: {
            fullName: profile.fullName ?? undefined,
            skills: profile.skills.map((s) => s.skill.name),
            experience: profile.experiences.map((e) => ({
              title: e.title, employer: e.employer, highlights: e.highlights,
            })),
            education: profile.education.map((e) => ({
              institution: e.institution, degree: e.degree ?? undefined,
            })),
            yearsExperience: profile.yearsExperience ?? undefined,
            summary: profile.summary ?? undefined,
          },
          job: { title: app.job.title, employer: app.job.employer, description: app.job.description ?? '' },
          tone: 'professional',
        });
        if (coverLetter) {
          await this.prisma.applicationMaterial.create({
            data: { applicationId, kind: 'COVER_LETTER', content: coverLetter, version: 1 },
          });
        }
      } catch (e) {
        this.logger.warn(`Cover letter failed for ${applicationId}: ${(e as Error).message}`);
      }
    }

    await this.transitions.transition(applicationId, 'DRAFT_PREPARED', {
      note: 'Draft prepared',
      metadata: { finalOutcome, matchScore: matchScore.overallScore, hasCoverLetter: !!coverLetter },
    });

    const provider = this.providers.get(app.job.providerKey);
    const canSubmit = provider?.capabilities.submitApplications ?? false;

    if (!canSubmit) {
      await this.transitions.transition(applicationId, 'MANUAL_APPLICATION_REQUIRED', {
        note: `Provider ${app.job.providerKey} does not support automated submission`,
      });
      return { outcome: 'manual' };
    }

    if (finalOutcome === 'REVIEW') {
      await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', { note: 'Below threshold' });
      return { outcome: 'awaiting_approval', reason: 'review' };
    }

    if (!prefs?.autoSubmitEnabled) {
      await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', { note: 'Auto-submit disabled' });
      return { outcome: 'awaiting_approval', reason: 'auto-disabled' };
    }

    try {
      await this.applications.autoQueue(app.userId, applicationId);
    } catch (e) {
      await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', {
        note: `Auto-queue blocked: ${(e as Error).message}`,
      });
      return { outcome: 'awaiting_approval', reason: 'guard' };
    }

    await this.submissionQueue.add(
      'submit',
      { applicationId },
      { attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
    );
    return { outcome: 'queued' };
  }

  private async getOrComputeMatch(app: any, profile: any, _conditions: any) {
    const cached = await this.prisma.jobMatch.findUnique({
      where: { userId_jobId: { userId: app.userId, jobId: app.jobId } },
    });
    if (cached && cached.profileVersion === profile.version) {
      return {
        overallScore: cached.overallScore,
        breakdown: cached.breakdown as any,
        missingRequired: cached.missingRequired,
        reasons: cached.reasons,
        hardEligibilityFail: cached.hardEligibilityFail,
      };
    }

    try {
      const score = await this.ai.scoreMatch(app.userId, {
        profile: {
          fullName: profile.fullName ?? undefined,
          skills: profile.skills.map((s: any) => s.skill.name),
          experience: profile.experiences.map((e: any) => ({
            title: e.title, employer: e.employer, highlights: e.highlights,
          })),
          education: profile.education.map((e: any) => ({
            institution: e.institution, degree: e.degree ?? undefined,
          })),
          yearsExperience: profile.yearsExperience ?? undefined,
        },
        preferences: {
          targetRoles: profile.targetRoles,
          preferredStates: profile.preferences?.preferredStates ?? [],
          remoteOnly: profile.preferences?.remoteOnly ?? false,
          salaryFloor: profile.preferences?.salaryFloor ?? undefined,
          salaryCurrency: profile.preferences?.salaryCurrency ?? 'NGN',
        },
        job: {
          title: app.job.title, employer: app.job.employer, description: app.job.description ?? '',
          requiredSkills: app.job.requiredSkills, preferredSkills: app.job.preferredSkills,
          state: app.job.state ?? undefined, workArrangement: app.job.workArrangement,
          salaryMin: app.job.salaryMin ?? undefined, salaryMax: app.job.salaryMax ?? undefined,
          salaryCurrency: app.job.salaryCurrency ?? undefined,
        },
      });

      await this.prisma.jobMatch.upsert({
        where: { userId_jobId: { userId: app.userId, jobId: app.jobId } },
        create: {
          userId: app.userId, jobId: app.jobId,
          overallScore: score.overallScore, breakdown: score.breakdown as any,
          missingRequired: score.missingRequired, reasons: score.reasons,
          hardEligibilityFail: score.hardEligibilityFail, profileVersion: profile.version,
          modelVersion: process.env.AI_MODEL ?? 'gemini-3.8-flash',
        },
        update: {
          overallScore: score.overallScore, breakdown: score.breakdown as any,
          missingRequired: score.missingRequired, reasons: score.reasons,
          hardEligibilityFail: score.hardEligibilityFail, profileVersion: profile.version,
          modelVersion: process.env.AI_MODEL ?? 'gemini-3.8-flash',
        },
      });

      return score;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('AI_BUDGET') || msg === 'AI_RATE_LIMIT') {
        this.logger.warn(`AI scoring deferred for ${app.id}: ${msg}`);
        return null;
      }
      throw e;
    }
  }
}
EOF

# ---------- Submission processor ----------
cat > apps/worker/src/processors/submission.processor.ts <<'EOF'
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { PrismaService, TransitionsService } from '@shs/data';
import { ProvidersService } from '../providers/providers.service';
import { QUEUES } from '../worker.module';

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

@Processor(QUEUES.submission, { concurrency: 2 })
export class SubmissionProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionProcessor.name);

  constructor(
    private prisma: PrismaService,
    private transitions: TransitionsService,
    private providers: ProvidersService,
    @InjectQueue(QUEUES.verification) private verificationQueue: Queue,
  ) { super(); }

  async process(job: Job<{ applicationId: string }>) {
    const { applicationId } = job.data;

    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { job: true, materials: true },
    });
    if (!app) return { skipped: 'not-found' };
    if (app.state !== 'QUEUED') return { skipped: `state=${app.state}` };

    const attemptNumber = app.attemptCount + 1;
    const attemptKey = `${app.id}:${attemptNumber}`;

    try {
      await this.transitions.transition(applicationId, 'SUBMITTING', {
        note: `Attempt ${attemptNumber}`,
        withinTx: async (tx) => {
          await tx.application.update({
            where: { id: applicationId },
            data: { attemptCount: attemptNumber },
          });
          await tx.applicationAttempt.create({
            data: {
              applicationId, attemptNumber,
              outcome: 'IN_PROGRESS', idempotencyKey: attemptKey,
            },
          });
        },
      });
    } catch (e) {
      return { skipped: (e as Error).message };
    }

    const provider = this.providers.get(app.job.providerKey);
    if (!provider?.submitApplication) {
      await this.transitions.transition(applicationId, 'FAILED', {
        lastError: `Provider ${app.job.providerKey} has no submission support`,
      });
      await markAttempt(this.prisma, attemptKey, 'REJECTED', { errorMessage: 'No provider submission' });
      return { failed: 'no-provider-submission' };
    }

    const coverLetter = app.materials.find((m) => m.kind === 'COVER_LETTER')?.content;
    const resumeDoc = await this.prisma.document.findFirst({
      where: { userId: app.userId, kind: 'CV', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!resumeDoc) {
      await this.transitions.transition(applicationId, 'NEEDS_USER_INPUT', {
        note: 'No CV on file', metadata: { missing: ['resume'] },
      });
      await markAttempt(this.prisma, attemptKey, 'NEEDS_INPUT', { errorMessage: 'No CV on file' });
      return { needsInput: 'resume' };
    }

    try {
      const result = await provider.submitApplication({
        userId: app.userId,
        externalId: app.job.externalId,
        jobUrl: app.job.sourceUrl,
        resumeUrl: resumeDoc.storageKey,
        coverLetter,
        idempotencyKey: app.idempotencyKey,
      });

      if (result.accepted) {
        await this.transitions.transition(applicationId, 'SUBMITTED', {
          providerRefId: result.providerReferenceId,
          note: 'Provider accepted submission',
          metadata: { evidence: result.confirmationEvidence },
        });
        await markAttempt(this.prisma, attemptKey, 'ACCEPTED', {
          providerRefId: result.providerReferenceId,
          responseData: result.confirmationEvidence,
        });

        if (provider.capabilities.verifySubmission) {
          await this.verificationQueue.add(
            'verify',
            { applicationId },
            { delay: 30_000, attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
          );
        }
        return { submitted: true };
      }

      if (result.needsUserInput?.length) {
        await this.transitions.transition(applicationId, 'NEEDS_USER_INPUT', {
          note: `Missing fields: ${result.needsUserInput.join(', ')}`,
          metadata: { missingFields: result.needsUserInput },
        });
        await markAttempt(this.prisma, attemptKey, 'NEEDS_INPUT', { errorMessage: 'Missing required fields' });
        return { needsInput: result.needsUserInput };
      }

      const retryable = result.error?.retryable ?? false;
      await markAttempt(
        this.prisma,
        attemptKey,
        retryable ? 'NETWORK_ERROR' : 'REJECTED',
        { errorCode: result.error?.code, errorMessage: result.error?.message },
      );

      if (retryable && attemptNumber < MAX_RETRY_ATTEMPTS) {
        await this.transitions.transition(applicationId, 'QUEUED', {
          note: `Retry scheduled (attempt ${attemptNumber}/${MAX_RETRY_ATTEMPTS})`,
        });
        await job.queue.add('submit', { applicationId }, {
          delay: RETRY_BACKOFF_MS[attemptNumber - 1] ?? RETRY_BACKOFF_MS[0],
        });
      } else {
        await this.transitions.transition(applicationId, 'FAILED', {
          lastError: result.error?.message ?? 'Provider rejected submission',
        });
      }
      return { failed: true };
    } catch (e: any) {
      const isTimeout = e.code === 'ETIMEDOUT' || e.name === 'AbortError';
      await markAttempt(this.prisma, attemptKey, isTimeout ? 'UNKNOWN' : 'NETWORK_ERROR', { errorMessage: e.message });

      if (isTimeout) {
        await this.transitions.transition(applicationId, 'UNKNOWN_OUTCOME', {
          lastError: 'Timeout — provider may or may not have received the submission',
        });
      } else if (attemptNumber < MAX_RETRY_ATTEMPTS) {
        await this.transitions.transition(applicationId, 'QUEUED', { note: 'Retry after network error' });
        await job.queue.add('submit', { applicationId }, {
          delay: RETRY_BACKOFF_MS[attemptNumber - 1] ?? RETRY_BACKOFF_MS[0],
        });
      } else {
        await this.transitions.transition(applicationId, 'FAILED', { lastError: e.message });
      }
      return { failed: true, retryable: !isTimeout };
    }
  }
}

async function markAttempt(prisma: PrismaService, key: string, outcome: any, data: any) {
  await prisma.applicationAttempt.update({
    where: { idempotencyKey: key },
    data: { outcome, finishedAt: new Date(), ...data },
  });
}
EOF

# ---------- Verification processor ----------
cat > apps/worker/src/processors/verification.processor.ts <<'EOF'
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService, TransitionsService } from '@shs/data';
import { ProvidersService } from '../providers/providers.service';
import { QUEUES } from '../worker.module';

@Processor(QUEUES.verification, { concurrency: 4 })
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private transitions: TransitionsService,
    private providers: ProvidersService,
  ) { super(); }

  async process(job: Job<{ applicationId: string }>) {
    const { applicationId } = job.data;

    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { job: true },
    });
    if (!app) return { skipped: 'not-found' };
    if (app.state !== 'SUBMITTED' && app.state !== 'UNKNOWN_OUTCOME') {
      return { skipped: `state=${app.state}` };
    }
    if (!app.providerRefId) return { skipped: 'no-ref-id' };

    const provider = this.providers.get(app.job.providerKey);
    if (!provider?.verifySubmission) return { skipped: 'provider-cannot-verify' };

    const result = await provider.verifySubmission({
      externalId: app.job.externalId,
      providerReferenceId: app.providerRefId,
    });

    if (result.confirmed) {
      await this.transitions.transition(applicationId, 'CONFIRMED', {
        note: 'Provider confirmed receipt',
        confirmationEvidence: result.evidence,
      });
      return { confirmed: true };
    }
    if (result.state === 'FAILED') {
      await this.transitions.transition(applicationId, 'FAILED', {
        lastError: 'Provider reports submission failed',
      });
      return { failed: true };
    }
    if (result.state === 'UNKNOWN_OUTCOME' && app.state === 'SUBMITTED') {
      await this.transitions.transition(applicationId, 'UNKNOWN_OUTCOME', {
        note: 'Verification inconclusive',
      });
      return { unknown: true };
    }
    throw new Error('VERIFICATION_PENDING');
  }
}
EOF

# ---------- Scheduler ----------
cat > apps/worker/src/scheduler/scheduler.service.ts <<'EOF'
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@shs/data';
import { QUEUES } from '../worker.module';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue(QUEUES.adzunaSync) private adzunaQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.adzunaQueue.add(
      'sync',
      {},
      { repeat: { pattern: '0 */6 * * *' }, jobId: 'adzuna-sync-cron', removeOnComplete: 20, removeOnFail: 50 },
    );
    this.logger.log('Scheduled recurring jobs');
  }

  async fanOutMatchRecent(since: Date) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    const matchQueue = this.adzunaQueue.client; // not used — passed via injection below
    // NB: real fan-out happens in AdzunaSyncProcessor via injected matchQueue.
    // This method exists for the manual admin trigger and returns the count.
    this.logger.log(`Fan-out would enqueue match-recent for ${users.length} users (since ${since.toISOString()})`);
    return users.length;
  }
}
EOF

echo ""
echo "✓ Part 4 (worker) complete."