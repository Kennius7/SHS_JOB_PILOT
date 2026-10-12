import { NotFoundException } from '@nestjs/common';
import { JobsService } from './jobs.service';

function makePrisma() {
  return {
    job: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    savedJob: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    jobMatch: { findUnique: jest.fn() },
  } as any;
}

describe('JobsService', () => {
  let prisma: any;
  let service: JobsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new JobsService(prisma);
  });

  describe('search', () => {
    it('filters active jobs and flags saved ones', async () => {
      prisma.job.count.mockResolvedValue(1);
      prisma.job.findMany.mockResolvedValue([{ id: 'j1', title: 'Backend Engineer' }]);
      prisma.savedJob.findMany.mockResolvedValue([{ jobId: 'j1' }]);

      const result = await service.search('u1', {});

      expect(prisma.job.count).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual({ id: 'j1', title: 'Backend Engineer', saved: true });
    });

    it('clamps page size and adds a case-insensitive text filter', async () => {
      prisma.job.count.mockResolvedValue(0);
      prisma.job.findMany.mockResolvedValue([]);
      prisma.savedJob.findMany.mockResolvedValue([]);

      const result = await service.search('u1', { q: 'engineer', page: 2, pageSize: 1000 });

      const where = prisma.job.findMany.mock.calls[0][0].where;
      expect(where.OR[0].title).toEqual({ contains: 'engineer', mode: 'insensitive' });
      expect(result.pageSize).toBe(100);
      expect(prisma.job.findMany.mock.calls[0][0].skip).toBe(100);
    });

    it('forces REMOTE arrangement when remoteOnly is set', async () => {
      prisma.job.count.mockResolvedValue(0);
      prisma.job.findMany.mockResolvedValue([]);

      await service.search('u1', { remoteOnly: true, workArrangement: 'ONSITE' });

      const where = prisma.job.findMany.mock.calls[0][0].where;
      expect(where.workArrangement).toBe('REMOTE');
    });
  });

  describe('get', () => {
    it('throws when the job does not exist', async () => {
      prisma.job.findUnique.mockResolvedValue(null);
      await expect(service.get('u1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns saved and match flags for the user', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'j1', title: 'Job' });
      prisma.savedJob.findUnique.mockResolvedValue({ id: 's1' });
      prisma.jobMatch.findUnique.mockResolvedValue(null);

      const result = await service.get('u1', 'j1');
      expect(result.saved).toBe(true);
      expect(result.match).toBeNull();
    });
  });

  describe('save / unsave', () => {
    it('upserts a saved job', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'j1' });
      prisma.savedJob.upsert.mockResolvedValue({ id: 's1' });

      const result = await service.save('u1', 'j1');

      expect(prisma.savedJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_jobId: { userId: 'u1', jobId: 'j1' } } }),
      );
      expect(result).toEqual({ saved: true });
    });

    it('rejects saving an unknown job', async () => {
      prisma.job.findUnique.mockResolvedValue(null);
      await expect(service.save('u1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removes a saved job', async () => {
      prisma.savedJob.deleteMany.mockResolvedValue({ count: 1 });
      const result = await service.unsave('u1', 'j1');
      expect(prisma.savedJob.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', jobId: 'j1' },
      });
      expect(result).toEqual({ saved: false });
    });
  });
});
