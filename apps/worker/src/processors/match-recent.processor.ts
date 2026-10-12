import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { PrismaService, ApplicationsService, TransitionsService } from '@shs/data';
import {
  evaluateRule, RuleConditionsSchema,
  type EvalContext, type NigerianState, type WorkArrangement, type EmploymentType,
} from '@shs/rules';
import { QUEUES } from '../worker.module';

const BATCH_SIZE = 100;
const MAX_JOBS_PER_RUN = 500;

@Processor(QUEUES.matchRecent, { concurrency: 2 })
export class MatchRecentProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchRecentProcessor.name);

  constructor(
    private prisma: PrismaService,
    private applications: ApplicationsService,
    private transitions: TransitionsService,
    @InjectQueue(QUEUES.prepareApplication) private prepareQueue: Queue,
  ) { super(); }

  async process(job: Job<{ userId: string; since?: string }>) {
    const { userId, since } = job.data;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: { include: { skills: { include: { skill: true } }, preferences: true } },
        rules: { where: { isActive: true }, take: 1 },
      },
    });
    if (!user || user.deletedAt || !user.isActive) return { skipped: 'user-inactive' };
    if (!user.profile) return { skipped: 'no-profile' };
    if (!user.rules[0]) return { skipped: 'no-active-rule' };

    const rule = user.rules[0];
    const conditions = RuleConditionsSchema.parse(rule.conditions);
    const profileVersion = user.profile.version;

    const profileCtx: EvalContext['profile'] = {
      targetRoles: user.profile.targetRoles,
      yearsExperience: user.profile.yearsExperience,
      skills: user.profile.skills.map((s) => s.skill.name),
      preferredStates: (user.profile.preferences?.preferredStates ?? []) as NigerianState[],
      remoteOnly: user.profile.preferences?.remoteOnly ?? false,
      salaryFloor: user.profile.preferences?.salaryFloor ?? null,
      salaryCurrency: user.profile.preferences?.salaryCurrency ?? 'NGN',
      excludedCompanies: user.profile.preferences?.excludedCompanies ?? [],
      employmentTypes: (user.profile.preferences?.employmentTypes ?? []) as EmploymentType[],
    };

    const alreadyEvaluated = await this.prisma.ruleEvaluation.findMany({
      where: { ruleId: rule.id },
      select: { jobId: true },
    });
    const seen = new Set(alreadyEvaluated.map((e) => e.jobId));

    let cursor: string | undefined;
    let examined = 0, eligible = 0, review = 0, ineligible = 0, created = 0;

    while (examined < MAX_JOBS_PER_RUN) {
      const jobs = await this.prisma.job.findMany({
        where: { status: 'ACTIVE', ...(since ? { firstSeenAt: { gte: new Date(since) } } : {}) },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });
      if (jobs.length === 0) break;
      cursor = jobs[jobs.length - 1].id;
      const fresh = jobs.filter((j) => !seen.has(j.id));

      for (const j of fresh) {
        examined++;
        const ctx: EvalContext = {
          job: {
            title: j.title, description: j.description, employer: j.employer,
            state: j.state, workArrangement: j.workArrangement as WorkArrangement,
            employmentType: j.employmentType as EmploymentType,
            salaryMin: j.salaryMin, salaryMax: j.salaryMax, salaryCurrency: j.salaryCurrency,
            requiredSkills: j.requiredSkills, preferredSkills: j.preferredSkills,
            experienceYears: j.experienceYears, seniority: j.seniority, publishedAt: j.publishedAt,
          },
          profile: profileCtx,
          now: new Date(),
        };
        const result = evaluateRule(conditions, ctx);

        await this.prisma.ruleEvaluation.create({
          data: {
            ruleId: rule.id, jobId: j.id, profileVersion,
            ruleVersion: rule.version, result: result.outcome, reasons: result.reasons,
          },
        });

        if (result.outcome === 'INELIGIBLE') { ineligible++; continue; }
        if (result.outcome === 'ELIGIBLE') eligible++; else review++;

        const app = await this.applications.createOrGet({
          userId, jobId: j.id, ruleEvalJson: result,
        });
        if (app.state !== 'DISCOVERED') continue;

        try {
          await this.transitions.transition(app.id, 'MATCHED', { note: 'Passed deterministic rules engine' });
          await this.transitions.transition(app.id, 'ELIGIBILITY_CHECKED', { note: `Rules: ${result.outcome}` });
        } catch (e) {
          this.logger.warn(`Transition failed for ${app.id}: ${(e as Error).message}`);
          continue;
        }
        created++;
        await this.prepareQueue.add(
          'prepare',
          { applicationId: app.id },
          { attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 500, removeOnFail: 1000 },
        );
      }

      if (jobs.length < BATCH_SIZE) break;
    }

    this.logger.log(`match-recent[${userId}]: examined=${examined} eligible=${eligible} review=${review} ineligible=${ineligible} created=${created}`);
    return { examined, eligible, review, ineligible, created };
  }
}
