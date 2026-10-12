import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@shs/data';

@Injectable()
export class AutomationService {
  constructor(private prisma: PrismaService) {}

  private async requirePreferences(userId: string) {
    const prefs = await this.prisma.careerPreference.findFirst({
      where: { profile: { userId } },
    });
    if (!prefs) throw new BadRequestException('Career preferences not configured');
    return prefs;
  }

  async status(userId: string) {
    const prefs = await this.requirePreferences(userId);

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [queued, submittedToday, awaitingApproval, activeRule] = await Promise.all([
      this.prisma.application.count({ where: { userId, state: 'QUEUED' } }),
      this.prisma.application.count({
        where: {
          userId,
          state: { in: ['SUBMITTED', 'CONFIRMED'] },
          submittedAt: { gte: startOfDay },
        },
      }),
      this.prisma.application.count({ where: { userId, state: 'AWAITING_APPROVAL' } }),
      this.prisma.applicationRule.findFirst({
        where: { userId, isActive: true },
        select: { id: true, name: true, version: true },
      }),
    ]);

    return {
      autoSubmitEnabled: prefs.autoSubmitEnabled,
      coverLetterAutoGen: prefs.coverLetterAutoGen,
      cvTailoringAllowed: prefs.cvTailoringAllowed,
      reviewOnMissingRequired: prefs.reviewOnMissingRequired,
      minMatchScore: prefs.minMatchScore,
      hasActiveRule: !!activeRule,
      activeRule,
      limits: {
        maxApplicationsPerDay: prefs.maxApplicationsPerDay,
        maxApplicationsPerWeek: prefs.maxApplicationsPerWeek,
      },
      usage: { submittedToday, queued, awaitingApproval },
    };
  }

  async pause(userId: string) {
    const prefs = await this.requirePreferences(userId);
    await this.prisma.careerPreference.update({
      where: { id: prefs.id },
      data: { autoSubmitEnabled: false },
    });
    return this.status(userId);
  }

  async resume(userId: string) {
    const prefs = await this.requirePreferences(userId);
    const activeRule = await this.prisma.applicationRule.findFirst({
      where: { userId, isActive: true },
    });
    if (!activeRule) {
      throw new BadRequestException(
        'An active application rule is required before enabling automatic submission',
      );
    }
    await this.prisma.careerPreference.update({
      where: { id: prefs.id },
      data: { autoSubmitEnabled: true },
    });
    return this.status(userId);
  }
}
