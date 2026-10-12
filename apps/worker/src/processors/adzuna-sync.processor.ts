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
