import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@shs/data';

const QUEUE_NAMES = [
  'provider-sync',
  'match-recent',
  'prepare-application',
  'application-submission',
  'application-verification',
] as const;

@Injectable()
export class AdminOpsService {
  private readonly queueMap: Record<string, Queue>;

  constructor(
    private prisma: PrismaService,
    @InjectQueue('provider-sync') providerSync: Queue,
    @InjectQueue('match-recent') matchRecent: Queue,
    @InjectQueue('prepare-application') prepareApplication: Queue,
    @InjectQueue('application-submission') applicationSubmission: Queue,
    @InjectQueue('application-verification') applicationVerification: Queue,
  ) {
    this.queueMap = {
      'provider-sync': providerSync,
      'match-recent': matchRecent,
      'prepare-application': prepareApplication,
      'application-submission': applicationSubmission,
      'application-verification': applicationVerification,
    };
  }

  async providers() {
    const providers = await this.prisma.jobProvider.findMany({ orderBy: { key: 'asc' } });
    return providers.map((p) => ({
      key: p.key,
      displayName: p.displayName,
      accessMode: p.accessMode,
      capabilities: p.capabilities,
      enabled: p.enabled,
      configured: p.configured,
      healthy: p.healthy,
      lastSyncAt: p.lastSyncAt,
      lastError: p.lastError,
      lastErrorAt: p.lastErrorAt,
    }));
  }

  async queues() {
    const result = await Promise.all(
      QUEUE_NAMES.map(async (name) => {
        const queue = this.queueMap[name];
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
        );
        const isPaused = await queue.isPaused();
        return { name, counts, paused: isPaused };
      }),
    );
    return { queues: result };
  }

  async health() {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (e: any) {
      checks.database = { ok: false, detail: e?.message ?? 'database error' };
    }

    try {
      await this.queueMap['match-recent'].getJobCounts('waiting');
      checks.redis = { ok: true };
    } catch (e: any) {
      checks.redis = { ok: false, detail: e?.message ?? 'redis error' };
    }

    const providerCounts = await this.prisma.jobProvider.groupBy({
      by: ['healthy'],
      _count: { _all: true },
    });

    const ok = Object.values(checks).every((c) => c.ok);
    return {
      status: ok ? 'ok' : 'degraded',
      checks,
      providers: providerCounts.map((p) => ({ healthy: p.healthy, count: p._count._all })),
    };
  }

  async triggerSync(key: string) {
    const provider = await this.prisma.jobProvider.findUnique({ where: { key } });
    if (!provider) throw new BadRequestException(`Provider "${key}" is not registered`);
    const caps = (provider.capabilities ?? {}) as { searchJobs?: boolean };
    if (!caps.searchJobs) {
      throw new BadRequestException(`Provider "${key}" does not support automated job sync`);
    }
    const job = await this.queueMap['provider-sync'].add(
      'manual',
      { providerKey: key, triggeredBy: 'admin' },
      { jobId: `admin-sync-${Date.now()}`, removeOnComplete: 100, removeOnFail: 200 },
    );
    return { queued: true, jobId: job.id, providerKey: key };
  }
}
