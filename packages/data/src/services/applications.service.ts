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
