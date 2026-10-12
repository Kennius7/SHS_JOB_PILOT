import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { PrismaService, TransitionsService } from '@shs/data';
import { ProvidersService } from '../providers/providers.service';
import { QUEUES } from '../worker.module';

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

@Processor(QUEUES.submission, { concurrency: 2 })
export class SubmissionProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionProcessor.name);

  constructor(
    private prisma: PrismaService,
    private transitions: TransitionsService,
    private providers: ProvidersService,
    @InjectQueue(QUEUES.submission) private submissionQueue: Queue,
    @InjectQueue(QUEUES.verification) private verificationQueue: Queue,
  ) { super(); }

  async process(job: Job<{ applicationId: string }>) {
    const { applicationId } = job.data;

    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { job: true, materials: true },
    });
    if (!app) return { skipped: 'not-found' };
    if (app.state !== 'QUEUED') return { skipped: `state=${app.state}` };

    const attemptNumber = app.attemptCount + 1;
    const attemptKey = `${app.id}:${attemptNumber}`;

    try {
      await this.transitions.transition(applicationId, 'SUBMITTING', {
        note: `Attempt ${attemptNumber}`,
        withinTx: async (tx) => {
          await tx.application.update({
            where: { id: applicationId },
            data: { attemptCount: attemptNumber },
          });
          await tx.applicationAttempt.create({
            data: {
              applicationId, attemptNumber,
              outcome: 'IN_PROGRESS', idempotencyKey: attemptKey,
            },
          });
        },
      });
    } catch (e) {
      return { skipped: (e as Error).message };
    }

    const provider = this.providers.get(app.job.providerKey);
    if (!provider?.submitApplication) {
      await this.transitions.transition(applicationId, 'FAILED', {
        lastError: `Provider ${app.job.providerKey} has no submission support`,
      });
      await markAttempt(this.prisma, attemptKey, 'REJECTED', { errorMessage: 'No provider submission' });
      return { failed: 'no-provider-submission' };
    }

    const coverLetter = app.materials.find((m) => m.kind === 'COVER_LETTER')?.content ?? undefined;
    const resumeDoc = await this.prisma.document.findFirst({
      where: { userId: app.userId, kind: 'CV', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!resumeDoc) {
      await this.transitions.transition(applicationId, 'NEEDS_USER_INPUT', {
        note: 'No CV on file', metadata: { missing: ['resume'] },
      });
      await markAttempt(this.prisma, attemptKey, 'NEEDS_INPUT', { errorMessage: 'No CV on file' });
      return { needsInput: 'resume' };
    }

    try {
      const result = await provider.submitApplication({
        userId: app.userId,
        externalId: app.job.externalId,
        jobUrl: app.job.sourceUrl,
        resumeUrl: resumeDoc.storageKey,
        coverLetter,
        idempotencyKey: app.idempotencyKey,
      });

      if (result.accepted) {
        await this.transitions.transition(applicationId, 'SUBMITTED', {
          providerRefId: result.providerReferenceId,
          note: 'Provider accepted submission',
          metadata: { evidence: result.confirmationEvidence },
        });
        await markAttempt(this.prisma, attemptKey, 'ACCEPTED', {
          providerRefId: result.providerReferenceId,
          responseData: result.confirmationEvidence,
        });

        if (provider.capabilities.verifySubmission) {
          await this.verificationQueue.add(
            'verify',
            { applicationId },
            { delay: 30_000, attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
          );
        }
        return { submitted: true };
      }

      if (result.needsUserInput?.length) {
        await this.transitions.transition(applicationId, 'NEEDS_USER_INPUT', {
          note: `Missing fields: ${result.needsUserInput.join(', ')}`,
          metadata: { missingFields: result.needsUserInput },
        });
        await markAttempt(this.prisma, attemptKey, 'NEEDS_INPUT', { errorMessage: 'Missing required fields' });
        return { needsInput: result.needsUserInput };
      }

      const retryable = result.error?.retryable ?? false;
      await markAttempt(
        this.prisma,
        attemptKey,
        retryable ? 'NETWORK_ERROR' : 'REJECTED',
        { errorCode: result.error?.code, errorMessage: result.error?.message },
      );

      if (retryable && attemptNumber < MAX_RETRY_ATTEMPTS) {
        await this.transitions.transition(applicationId, 'QUEUED', {
          note: `Retry scheduled (attempt ${attemptNumber}/${MAX_RETRY_ATTEMPTS})`,
        });
        await this.submissionQueue.add('submit', { applicationId }, {
          delay: RETRY_BACKOFF_MS[attemptNumber - 1] ?? RETRY_BACKOFF_MS[0],
        });
      } else {
        await this.transitions.transition(applicationId, 'FAILED', {
          lastError: result.error?.message ?? 'Provider rejected submission',
        });
      }
      return { failed: true };
    } catch (e: any) {
      const isTimeout = e.code === 'ETIMEDOUT' || e.name === 'AbortError';
      await markAttempt(this.prisma, attemptKey, isTimeout ? 'UNKNOWN' : 'NETWORK_ERROR', { errorMessage: e.message });

      if (isTimeout) {
        await this.transitions.transition(applicationId, 'UNKNOWN_OUTCOME', {
          lastError: 'Timeout — provider may or may not have received the submission',
        });
      } else if (attemptNumber < MAX_RETRY_ATTEMPTS) {
        await this.transitions.transition(applicationId, 'QUEUED', { note: 'Retry after network error' });
        await this.submissionQueue.add('submit', { applicationId }, {
          delay: RETRY_BACKOFF_MS[attemptNumber - 1] ?? RETRY_BACKOFF_MS[0],
        });
      } else {
        await this.transitions.transition(applicationId, 'FAILED', { lastError: e.message });
      }
      return { failed: true, retryable: !isTimeout };
    }
  }
}

async function markAttempt(prisma: PrismaService, key: string, outcome: any, data: any) {
  await prisma.applicationAttempt.updateMany({
    where: { idempotencyKey: key },
    data: { outcome, finishedAt: new Date(), ...data },
  });
}
