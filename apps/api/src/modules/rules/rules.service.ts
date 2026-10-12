import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@shs/data';
import {
  RuleConditionsSchema,
  evaluateRule,
  type EvalContext,
  type RuleConditions,
  type NigerianState,
  type WorkArrangement,
  type EmploymentType,
} from '@shs/rules';

const SIMULATION_BATCH_SIZE = 500;
const SIMULATION_MAX_JOBS = 20_000;

@Injectable()
export class RulesService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.applicationRule.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getActive(userId: string) {
    return this.prisma.applicationRule.findFirst({
      where: { userId, isActive: true },
    });
  }

  async create(userId: string, name: string, conditions: unknown) {
    const parsed = RuleConditionsSchema.parse(conditions);
    return this.prisma.$transaction(async (tx) => {
      await tx.applicationRule.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });
      return tx.applicationRule.create({
        data: {
          userId,
          name,
          conditions: parsed as any,
          isActive: true,
          version: 1,
        },
      });
    });
  }

  async update(
    userId: string,
    ruleId: string,
    patch: { name?: string; conditions?: unknown; isActive?: boolean },
  ) {
    const rule = await this.prisma.applicationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException();
    if (rule.userId !== userId) throw new ForbiddenException();

    const data: any = { version: { increment: 1 } };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.conditions !== undefined) {
      data.conditions = RuleConditionsSchema.parse(patch.conditions) as any;
    }

    return this.prisma.$transaction(async (tx) => {
      if (patch.isActive === true) {
        await tx.applicationRule.updateMany({
          where: { userId, id: { not: ruleId }, isActive: true },
          data: { isActive: false },
        });
      }
      return tx.applicationRule.update({ where: { id: ruleId }, data });
    });
  }

  async remove(userId: string, ruleId: string) {
    const rule = await this.prisma.applicationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException();
    if (rule.userId !== userId) throw new ForbiddenException();
    await this.prisma.applicationRule.delete({ where: { id: ruleId } });
  }

  async simulate(userId: string, conditions: unknown) {
    const parsed = RuleConditionsSchema.parse(conditions);
    const profileCtx = await this.loadProfileContext(userId);
    const now = new Date();

    const summary: any = {
      evaluated: 0, eligible: 0, review: 0, ineligible: 0,
      hardFailureCounts: {}, softFailureCounts: {},
      sampleIneligible: [], sampleEligible: [],
    };

    let cursor: string | undefined;
    while (summary.evaluated < SIMULATION_MAX_JOBS) {
      const jobs = await this.prisma.job.findMany({
        where: { status: 'ACTIVE' },
        take: SIMULATION_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });
      if (jobs.length === 0) break;
      cursor = jobs[jobs.length - 1].id;

      for (const job of jobs) {
        const ctx = this.buildContext(job, profileCtx, now);
        const result = evaluateRule(parsed, ctx);
        summary.evaluated++;
        if (result.outcome === 'ELIGIBLE') summary.eligible++;
        else if (result.outcome === 'REVIEW') summary.review++;
        else summary.ineligible++;

        for (const f of result.hardFailures) {
          summary.hardFailureCounts[f.conditionType] =
            (summary.hardFailureCounts[f.conditionType] ?? 0) + 1;
        }
        if (result.outcome === 'INELIGIBLE' && summary.sampleIneligible.length < 10) {
          summary.sampleIneligible.push({ jobId: job.id, title: job.title, reasons: result.reasons });
        }
        if (result.outcome === 'ELIGIBLE' && summary.sampleEligible.length < 10) {
          summary.sampleEligible.push({ jobId: job.id, title: job.title, score: null });
        }
      }

      if (jobs.length < SIMULATION_BATCH_SIZE) break;
    }

    return summary;
  }

  private async loadProfileContext(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: { skills: { include: { skill: true } }, preferences: true },
    });
    if (!profile) throw new BadRequestException('Profile not set up');

    return {
      targetRoles: profile.targetRoles,
      yearsExperience: profile.yearsExperience,
      skills: profile.skills.map((s) => s.skill.name),
      preferredStates: (profile.preferences?.preferredStates ?? []) as NigerianState[],
      remoteOnly: profile.preferences?.remoteOnly ?? false,
      salaryFloor: profile.preferences?.salaryFloor ?? null,
      salaryCurrency: profile.preferences?.salaryCurrency ?? 'NGN',
      excludedCompanies: profile.preferences?.excludedCompanies ?? [],
      employmentTypes: (profile.preferences?.employmentTypes ?? []) as EmploymentType[],
    };
  }

  private buildContext(job: any, profile: EvalContext['profile'], now: Date): EvalContext {
    return {
      job: {
        title: job.title,
        description: job.description,
        employer: job.employer,
        state: job.state,
        workArrangement: job.workArrangement as WorkArrangement,
        employmentType: job.employmentType as EmploymentType,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        requiredSkills: job.requiredSkills,
        preferredSkills: job.preferredSkills,
        experienceYears: job.experienceYears,
        seniority: job.seniority,
        publishedAt: job.publishedAt,
      },
      profile,
      now,
    };
  }
}
