import { BadRequestException } from '@nestjs/common';
import { AutomationService } from './automation.service';

function makePrisma(prefs: any) {
  return {
    careerPreference: {
      findFirst: jest.fn().mockResolvedValue(prefs),
      update: jest.fn().mockResolvedValue({}),
    },
    application: { count: jest.fn().mockResolvedValue(0) },
    applicationRule: { findFirst: jest.fn() },
  } as any;
}

const PREFS = {
  id: 'p1',
  autoSubmitEnabled: true,
  coverLetterAutoGen: true,
  cvTailoringAllowed: false,
  reviewOnMissingRequired: false,
  minMatchScore: 70,
  maxApplicationsPerDay: 10,
  maxApplicationsPerWeek: 50,
};

describe('AutomationService', () => {
  it('requires configured preferences', async () => {
    const service = new AutomationService(makePrisma(null));
    await expect(service.status('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports automation status', async () => {
    const prisma = makePrisma(PREFS);
    prisma.applicationRule.findFirst.mockResolvedValue({ id: 'r1', name: 'Rule', version: 1 });
    const service = new AutomationService(prisma);

    const status = await service.status('u1');

    expect(status.autoSubmitEnabled).toBe(true);
    expect(status.hasActiveRule).toBe(true);
    expect(status.limits.maxApplicationsPerDay).toBe(10);
  });

  it('pauses automatic submission', async () => {
    const prisma = makePrisma(PREFS);
    prisma.applicationRule.findFirst.mockResolvedValue(null);
    const service = new AutomationService(prisma);

    await service.pause('u1');

    expect(prisma.careerPreference.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { autoSubmitEnabled: false },
    });
  });

  it('refuses to resume without an active rule', async () => {
    const prisma = makePrisma(PREFS);
    prisma.applicationRule.findFirst.mockResolvedValue(null);
    const service = new AutomationService(prisma);

    await expect(service.resume('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.careerPreference.update).not.toHaveBeenCalled();
  });

  it('resumes automatic submission when a rule exists', async () => {
    const prisma = makePrisma(PREFS);
    prisma.applicationRule.findFirst.mockResolvedValue({ id: 'r1', version: 1 });
    const service = new AutomationService(prisma);

    await service.resume('u1');

    expect(prisma.careerPreference.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { autoSubmitEnabled: true },
    });
  });
});
