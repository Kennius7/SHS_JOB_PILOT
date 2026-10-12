import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@shs/data';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface JobSearchParams {
  q?: string;
  state?: string;
  workArrangement?: string;
  employmentType?: string;
  providerKey?: string;
  remoteOnly?: boolean;
  salaryMin?: number;
  page?: number;
  pageSize?: number;
}

const SUMMARY_SELECT = {
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
  salaryPeriod: true,
  seniority: true,
  publishedAt: true,
  sourceUrl: true,
  applyUrl: true,
  providerKey: true,
  attribution: true,
  requiredSkills: true,
  preferredSkills: true,
} as const;

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  async search(userId: string, params: JobSearchParams) {
    const page = Math.max(1, Math.trunc(params.page ?? 1) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
    );

    const where: any = { status: 'ACTIVE' };
    if (params.workArrangement) where.workArrangement = params.workArrangement;
    if (params.employmentType) where.employmentType = params.employmentType;
    if (params.providerKey) where.providerKey = params.providerKey;
    if (params.state) where.state = params.state;
    if (params.remoteOnly) where.workArrangement = 'REMOTE';
    if (params.salaryMin != null) where.salaryMin = { gte: params.salaryMin };
    if (params.q) {
      where.OR = [
        { title: { contains: params.q, mode: 'insensitive' } },
        { employer: { contains: params.q, mode: 'insensitive' } },
        { description: { contains: params.q, mode: 'insensitive' } },
        { requiredSkills: { has: params.q } },
        { preferredSkills: { has: params.q } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { firstSeenAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SUMMARY_SELECT,
      }),
    ]);

    const jobIds = items.map((j) => j.id);
    const saved = jobIds.length
      ? await this.prisma.savedJob.findMany({
          where: { userId, jobId: { in: jobIds } },
          select: { jobId: true },
        })
      : [];
    const savedSet = new Set(saved.map((s) => s.jobId));

    return {
      items: items.map((j) => ({ ...j, saved: savedSet.has(j.id) })),
      total,
      page,
      pageSize,
    };
  }

  async get(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    const [saved, match] = await Promise.all([
      this.prisma.savedJob.findUnique({ where: { userId_jobId: { userId, jobId } } }),
      this.prisma.jobMatch.findUnique({ where: { userId_jobId: { userId, jobId } } }),
    ]);

    return { ...job, saved: !!saved, match };
  }

  async save(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');
    await this.prisma.savedJob.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId },
      update: {},
    });
    return { saved: true };
  }

  async unsave(userId: string, jobId: string) {
    await this.prisma.savedJob.deleteMany({ where: { userId, jobId } });
    return { saved: false };
  }

  async listSaved(userId: string) {
    const rows = await this.prisma.savedJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { job: { select: SUMMARY_SELECT } },
    });
    return {
      items: rows.map((r) => ({ ...r.job, savedAt: r.createdAt, saved: true })),
      total: rows.length,
    };
  }
}
