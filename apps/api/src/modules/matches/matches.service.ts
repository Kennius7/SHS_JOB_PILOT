import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@shs/data';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const JOB_SELECT = {
  id: true,
  title: true,
  employer: true,
  city: true,
  state: true,
  workArrangement: true,
  employmentType: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  publishedAt: true,
  sourceUrl: true,
  applyUrl: true,
  providerKey: true,
  attribution: true,
} as const;

@Injectable()
export class MatchesService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, opts: { minScore?: number; page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.trunc(opts.page ?? 1) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(opts.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
    );

    const where: any = { userId };
    if (opts.minScore != null) where.overallScore = { gte: opts.minScore };

    const [total, items] = await Promise.all([
      this.prisma.jobMatch.count({ where }),
      this.prisma.jobMatch.findMany({
        where,
        orderBy: [{ overallScore: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { job: { select: JOB_SELECT } },
      }),
    ]);

    return { items, total, page, pageSize };
  }

  async getForJob(userId: string, jobId: string) {
    const match = await this.prisma.jobMatch.findUnique({
      where: { userId_jobId: { userId, jobId } },
      include: { job: { select: JOB_SELECT } },
    });
    if (!match) throw new NotFoundException('No match has been computed for this job');
    return match;
  }
}
