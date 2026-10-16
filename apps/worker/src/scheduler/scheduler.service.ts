import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@shs/data';
import { ProvidersService } from '../providers/providers.service';
import { QUEUES } from '../queues';

const SYNC_CRON = '0 */6 * * *';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private providers: ProvidersService,
    @InjectQueue(QUEUES.providerSync) private providerSyncQueue: Queue,
    @InjectQueue(QUEUES.matchRecent) private matchQueue: Queue,
  ) {}

  async onModuleInit() {
    const searchProviders = this.providers
      .registry_()
      .list()
      .filter((p) => p.capabilities.searchJobs);

    for (const provider of searchProviders) {
      await this.providerSyncQueue.add(
        'sync',
        { providerKey: provider.key },
        {
          repeat: { pattern: SYNC_CRON },
          jobId: `provider-sync-${provider.key}`,
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      );
    }

    this.logger.log(`Scheduled recurring sync for ${searchProviders.length} providers`);
  }

  /** Enqueue one match-recent job per active user. */
  async fanOutMatchRecent(since: Date): Promise<number> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    let enqueued = 0;
    for (const user of users) {
      await this.matchQueue.add(
        'user',
        { userId: user.id, since: since.toISOString() },
        {
          jobId: `match-${user.id}-${since.getTime()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
      enqueued++;
    }
    this.logger.log(`Fan-out: enqueued match-recent for ${enqueued} users`);
    return enqueued;
  }
}
