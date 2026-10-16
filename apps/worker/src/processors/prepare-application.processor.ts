import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { PrismaService, TransitionsService, ApplicationsService, AiService } from '@shs/data';
import { ProvidersService } from '../providers/providers.service';
import { RuleConditionsSchema } from '@shs/rules';
import { QUEUES } from '../queues';

@Processor(QUEUES.prepareApplication, { concurrency: 4 })
export class PrepareApplicationProcessor extends WorkerHost {
  private readonly logger = new Logger(PrepareApplicationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private transitions: TransitionsService,
    private applications: ApplicationsService,
    private ai: AiService,
    private providers: ProvidersService,
    @InjectQueue(QUEUES.submission) private submissionQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ applicationId: string }>) {
    const { applicationId } = job.data;

    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: true,
        user: {
          include: {
            profile: {
              include: {
                skills: { include: { skill: true } },
                experiences: true,
                preferences: true,
                education: true,
              },
            },
            rules: { where: { isActive: true }, take: 1 },
          },
        },
      },
    });
    if (!app) return { skipped: 'not-found' };
    if (app.state !== 'ELIGIBILITY_CHECKED') return { skipped: `state=${app.state}` };

    const rule = app.user.rules[0];
    if (!rule) {
      await this.transitions.transition(applicationId, 'FAILED', { lastError: 'No active rule' });
      return { failed: 'no-rule' };
    }
    const conditions = RuleConditionsSchema.parse(rule.conditions);
    const profile = app.user.profile;
    if (!profile) {
      await this.transitions.transition(applicationId, 'FAILED', { lastError: 'No profile' });
      return { failed: 'no-profile' };
    }

    const ruleOutcome = (app.ruleEvalJson as { outcome?: string } | null)?.outcome ?? 'REVIEW';
    const matchScore = await this.getOrComputeMatch(app, profile, conditions);

    if (matchScore === null) {
      await this.transitions.transition(applicationId, 'DRAFT_PREPARED', {
        note: 'Draft without AI scoring',
      });
      await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', {
        note: 'AI unavailable — manual review',
      });
      return { outcome: 'awaiting_approval', reason: 'ai-unavailable' };
    }

    let finalOutcome: 'ELIGIBLE' | 'REVIEW' | 'INELIGIBLE';
    if (ruleOutcome === 'INELIGIBLE' || matchScore.hardEligibilityFail) finalOutcome = 'INELIGIBLE';
    else if (ruleOutcome === 'REVIEW') finalOutcome = 'REVIEW';
    else if (matchScore.overallScore >= conditions.minMatchScore) finalOutcome = 'ELIGIBLE';
    else finalOutcome = 'REVIEW';

    if (finalOutcome === 'INELIGIBLE') {
      const reviewOverride = profile.preferences?.reviewOnMissingRequired ?? false;
      if (matchScore.hardEligibilityFail && reviewOverride) {
        await this.transitions.transition(applicationId, 'DRAFT_PREPARED', {
          note: 'AI flagged a hard fail, but reviewOnMissingRequired is enabled',
        });
        await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', {
          note: 'User must decide on missing required qualification',
          metadata: { missingRequired: matchScore.missingRequired },
        });
        return { outcome: 'awaiting_approval', reason: 'hard-fail-review-override' };
      }
      await this.transitions.transition(applicationId, 'SKIPPED', {
        note: matchScore.hardEligibilityFail
          ? 'Missing mandatory qualification per AI analysis'
          : `Match score below threshold`,
        metadata: {
          matchScore: matchScore.overallScore,
          missingRequired: matchScore.missingRequired,
        },
      });
      return { outcome: 'skipped' };
    }

    await this.prisma.application.update({
      where: { id: applicationId },
      data: { matchScore: matchScore.overallScore },
    });

    let coverLetter: string | null = null;
    const prefs = profile.preferences;
    if (prefs?.coverLetterAutoGen ?? true) {
      try {
        coverLetter = await this.ai.generateCoverLetter(app.userId, {
          profile: {
            fullName: profile.fullName ?? undefined,
            skills: profile.skills.map((s) => s.skill.name),
            experience: profile.experiences.map((e) => ({
              title: e.title,
              employer: e.employer,
              highlights: e.highlights,
            })),
            education: profile.education.map((e) => ({
              institution: e.institution,
              degree: e.degree ?? undefined,
            })),
            yearsExperience: profile.yearsExperience ?? undefined,
            summary: profile.summary ?? undefined,
          },
          job: {
            title: app.job.title,
            employer: app.job.employer,
            description: app.job.description ?? '',
          },
          tone: 'professional',
        });
        if (coverLetter) {
          await this.prisma.applicationMaterial.create({
            data: { applicationId, kind: 'COVER_LETTER', content: coverLetter, version: 1 },
          });
        }
      } catch (e) {
        this.logger.warn(`Cover letter failed for ${applicationId}: ${(e as Error).message}`);
      }
    }

    await this.transitions.transition(applicationId, 'DRAFT_PREPARED', {
      note: 'Draft prepared',
      metadata: {
        finalOutcome,
        matchScore: matchScore.overallScore,
        hasCoverLetter: !!coverLetter,
      },
    });

    const provider = this.providers.get(app.job.providerKey);
    const canSubmit = provider?.capabilities.submitApplications ?? false;

    if (!canSubmit) {
      await this.transitions.transition(applicationId, 'MANUAL_APPLICATION_REQUIRED', {
        note: `Provider ${app.job.providerKey} does not support automated submission`,
      });
      return { outcome: 'manual' };
    }

    if (finalOutcome === 'REVIEW') {
      await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', {
        note: 'Below threshold',
      });
      return { outcome: 'awaiting_approval', reason: 'review' };
    }

    if (!prefs?.autoSubmitEnabled) {
      await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', {
        note: 'Auto-submit disabled',
      });
      return { outcome: 'awaiting_approval', reason: 'auto-disabled' };
    }

    try {
      await this.applications.autoQueue(app.userId, applicationId);
    } catch (e) {
      await this.transitions.transition(applicationId, 'AWAITING_APPROVAL', {
        note: `Auto-queue blocked: ${(e as Error).message}`,
      });
      return { outcome: 'awaiting_approval', reason: 'guard' };
    }

    await this.submissionQueue.add(
      'submit',
      { applicationId },
      { attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
    );
    return { outcome: 'queued' };
  }

  private async getOrComputeMatch(app: any, profile: any, _conditions: any) {
    const cached = await this.prisma.jobMatch.findUnique({
      where: { userId_jobId: { userId: app.userId, jobId: app.jobId } },
    });
    if (cached && cached.profileVersion === profile.version) {
      return {
        overallScore: cached.overallScore,
        breakdown: cached.breakdown as any,
        missingRequired: cached.missingRequired,
        reasons: cached.reasons,
        hardEligibilityFail: cached.hardEligibilityFail,
      };
    }

    try {
      const score = await this.ai.scoreMatch(app.userId, {
        profile: {
          fullName: profile.fullName ?? undefined,
          skills: profile.skills.map((s: any) => s.skill.name),
          experience: profile.experiences.map((e: any) => ({
            title: e.title,
            employer: e.employer,
            highlights: e.highlights,
          })),
          education: profile.education.map((e: any) => ({
            institution: e.institution,
            degree: e.degree ?? undefined,
          })),
          yearsExperience: profile.yearsExperience ?? undefined,
        },
        preferences: {
          targetRoles: profile.targetRoles,
          preferredStates: profile.preferences?.preferredStates ?? [],
          remoteOnly: profile.preferences?.remoteOnly ?? false,
          salaryFloor: profile.preferences?.salaryFloor ?? undefined,
          salaryCurrency: profile.preferences?.salaryCurrency ?? 'NGN',
        },
        job: {
          title: app.job.title,
          employer: app.job.employer,
          description: app.job.description ?? '',
          requiredSkills: app.job.requiredSkills,
          preferredSkills: app.job.preferredSkills,
          state: app.job.state ?? undefined,
          workArrangement: app.job.workArrangement,
          salaryMin: app.job.salaryMin ?? undefined,
          salaryMax: app.job.salaryMax ?? undefined,
          salaryCurrency: app.job.salaryCurrency ?? undefined,
        },
      });

      await this.prisma.jobMatch.upsert({
        where: { userId_jobId: { userId: app.userId, jobId: app.jobId } },
        create: {
          userId: app.userId,
          jobId: app.jobId,
          overallScore: score.overallScore,
          breakdown: score.breakdown as any,
          missingRequired: score.missingRequired,
          reasons: score.reasons,
          hardEligibilityFail: score.hardEligibilityFail,
          profileVersion: profile.version,
          modelVersion: process.env.AI_MODEL ?? 'gemini-3.8-flash',
        },
        update: {
          overallScore: score.overallScore,
          breakdown: score.breakdown as any,
          missingRequired: score.missingRequired,
          reasons: score.reasons,
          hardEligibilityFail: score.hardEligibilityFail,
          profileVersion: profile.version,
          modelVersion: process.env.AI_MODEL ?? 'gemini-3.8-flash',
        },
      });

      return score;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('AI_BUDGET') || msg === 'AI_RATE_LIMIT') {
        this.logger.warn(`AI scoring deferred for ${app.id}: ${msg}`);
        return null;
      }
      throw e;
    }
  }
}
