import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '@shs/data';
import type { NormalizedJob } from '@shs/provider-sdk';
import { ProvidersService } from '../providers/providers.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { QUEUES } from '../queues';

const DEFAULT_KEYWORDS = [
  'software engineer', 'data analyst', 'product manager',
  'finance', 'sales', 'marketing', 'operations',
  'human resources', 'mechanical engineer', 'customer service',
];

interface ProviderSyncConfig {
  /** Search terms to fan out across. Omitted for fetchOnce providers. */
  keywords?: string[];
  /** Maximum pages fetched per query. */
  pages: number;
  /** Results requested per page. */
  resultsPerPage?: number;
  /** True when the API returns the full listing set in one call (boards, Remote OK). */
  fetchOnce?: boolean;
}

const SYNC_CONFIGS: Record<string, ProviderSyncConfig> = {
  adzuna: { keywords: DEFAULT_KEYWORDS, pages: 2, resultsPerPage: 50 },
  jooble: { keywords: DEFAULT_KEYWORDS, pages: 1, resultsPerPage: 50 },
  usajobs: {
    keywords: ['software engineer', 'data analyst', 'product manager', 'finance', 'sales', 'customer service'],
    pages: 1,
    resultsPerPage: 100,
  },
  remotive: {
    keywords: ['software', 'engineer', 'data', 'design', 'product', 'sales', 'marketing', 'support', 'finance'],
    pages: 1,
    resultsPerPage: 100,
  },
  remoteok: { fetchOnce: true, pages: 1 },
  greenhouse: { fetchOnce: true, pages: 2 },
  lever: { fetchOnce: true, pages: 1 },
  ashby: { fetchOnce: true, pages: 1 },
};

const DEFAULT_CONFIG: ProviderSyncConfig = { keywords: ['software'], pages: 1, resultsPerPage: 50 };

@Processor(QUEUES.providerSync, { concurrency: 1 })
export class ProviderSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ProviderSyncProcessor.name);

  constructor(
    private prisma: PrismaService,
    private providers: ProvidersService,
    private scheduler: SchedulerService,
    @InjectQueue(QUEUES.matchRecent) private matchQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ providerKey?: string }>) {
    const providerKey = job.data?.providerKey ?? 'adzuna';
    const adapter = this.providers.get(providerKey);
    if (!adapter) {
      this.logger.warn(`Provider "${providerKey}" has no adapter — skipping`);
      return { skipped: 'no-adapter' };
    }

    const availability = await adapter.checkAvailability();
    if (!availability.available) {
      await this.prisma.jobProvider.update({
        where: { key: providerKey },
        data: { healthy: false, lastError: availability.reason ?? 'unavailable', lastErrorAt: new Date() },
      });
      return { skipped: availability.reason };
    }

    const run = await this.prisma.providerSyncRun.create({
      data: { providerKey, status: 'RUNNING' },
    });

    const config = SYNC_CONFIGS[providerKey] ?? DEFAULT_CONFIG;
    const syncStartedAt = new Date();
    let jobsFound = 0, jobsNew = 0, jobsDuplicate = 0, jobsRejected = 0;

    try {
      const queries: Array<{ keywords?: string }> = config.fetchOnce
        ? [{}]
        : (config.keywords ?? ['']).map((keywords) => ({ keywords }));

      for (const query of queries) {
        for (let page = 1; page <= config.pages; page++) {
          const result = await adapter.searchJobs({
            keywords: query.keywords,
            page,
            pageSize: config.resultsPerPage,
          });
          jobsFound += result.jobs.length;

          for (const n of result.jobs) {
            if (!n.externalId || !n.title) {
              jobsRejected++;
              continue;
            }
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
                data: toPrismaJob(n, canonicalKey),
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
        data: {
          status: 'SUCCESS', finishedAt: new Date(),
          jobsFound, jobsNew, jobsDuplicate, jobsRejected,
        },
      });
      await this.prisma.jobProvider.update({
        where: { key: providerKey },
        data: { lastSyncAt: new Date(), healthy: true, lastError: null },
      });

      if (jobsNew > 0) {
        await this.scheduler.fanOutMatchRecent(syncStartedAt);
      }

      this.logger.log(`Sync ${providerKey}: found=${jobsFound} new=${jobsNew} dup=${jobsDuplicate}`);
      return { providerKey, jobsFound, jobsNew, jobsDuplicate };
    } catch (e) {
      await this.prisma.providerSyncRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: (e as Error).message },
      });
      await this.prisma.jobProvider.update({
        where: { key: providerKey },
        data: { healthy: false, lastError: (e as Error).message, lastErrorAt: new Date() },
      });
      throw e;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`provider-sync ${job.data?.providerKey} failed: ${err.message}`);
  }
}

function computeCanonicalKey(job: { externalId?: string; title: string }): string {
  return createHash('sha256').update(`${job.externalId}|${job.title}`).digest('hex').slice(0, 32);
}

function toPrismaJob(n: NormalizedJob, canonicalKey: string) {
  return {
    providerKey: n.providerKey,
    externalId: n.externalId,
    title: n.title,
    employer: n.employer,
    description: n.description,
    country: n.location?.country ?? 'UNKNOWN',
    city: n.location?.city,
    workArrangement: n.workArrangement,
    employmentType: n.employmentType,
    salaryMin: n.salary?.min,
    salaryMax: n.salary?.max,
    salaryCurrency: n.salary?.currency ?? 'USD',
    salaryPeriod: n.salary?.period,
    sourceUrl: n.sourceUrl,
    applyUrl: n.applyUrl,
    publishedAt: n.publishedAt ? new Date(n.publishedAt) : undefined,
    canonicalKey,
    attribution: n.attribution,
    usageRestrictions: n.usageRestrictions ?? [],
    rawPayload: n as any,
  };
}
