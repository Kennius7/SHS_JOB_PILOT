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
    @InjectQueue(QUEUES.matchRecent) private matchQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.adzunaQueue.add(
      'sync',
      {},
      {
        repeat: { pattern: '0 */6 * * *' },
        jobId: 'adzuna-sync-cron',
        removeOnComplete: 20,
        removeOnFail: 50,
      },
    );
    this.logger.log('Scheduled recurring jobs');
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
