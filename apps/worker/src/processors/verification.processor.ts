import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService, TransitionsService } from '@shs/data';
import { ProvidersService } from '../providers/providers.service';
import { QUEUES } from '../queues';

@Processor(QUEUES.verification, { concurrency: 4 })
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private transitions: TransitionsService,
    private providers: ProvidersService,
  ) {
    super();
  }

  async process(job: Job<{ applicationId: string }>) {
    const { applicationId } = job.data;

    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { job: true },
    });
    if (!app) return { skipped: 'not-found' };
    if (app.state !== 'SUBMITTED' && app.state !== 'UNKNOWN_OUTCOME') {
      return { skipped: `state=${app.state}` };
    }
    if (!app.providerRefId) return { skipped: 'no-ref-id' };

    const provider = this.providers.get(app.job.providerKey);
    if (!provider?.verifySubmission) return { skipped: 'provider-cannot-verify' };

    const result = await provider.verifySubmission({
      externalId: app.job.externalId,
      providerReferenceId: app.providerRefId,
    });

    if (result.confirmed) {
      await this.transitions.transition(applicationId, 'CONFIRMED', {
        note: 'Provider confirmed receipt',
        confirmationEvidence: result.evidence,
      });
      return { confirmed: true };
    }
    if (result.state === 'FAILED') {
      await this.transitions.transition(applicationId, 'FAILED', {
        lastError: 'Provider reports submission failed',
      });
      return { failed: true };
    }
    if (result.state === 'UNKNOWN_OUTCOME' && app.state === 'SUBMITTED') {
      await this.transitions.transition(applicationId, 'UNKNOWN_OUTCOME', {
        note: 'Verification inconclusive',
      });
      return { unknown: true };
    }
    throw new Error('VERIFICATION_PENDING');
  }
}
