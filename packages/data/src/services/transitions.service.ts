import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationState, assertCanTransition, IllegalStateTransitionError } from '@shs/shared';

interface TransitionOptions {
  note?: string;
  metadata?: Record<string, unknown>;
  providerRefId?: string;
  confirmationEvidence?: Record<string, unknown>;
  lastError?: string;
  withinTx?: (tx: any) => Promise<void>;
}

const USER_NOTIFY_STATES: ApplicationState[] = [
  'AWAITING_APPROVAL',
  'SUBMITTED',
  'CONFIRMED',
  'FAILED',
  'NEEDS_USER_INPUT',
  'MANUAL_APPLICATION_REQUIRED',
];

@Injectable()
export class TransitionsService {
  private readonly logger = new Logger(TransitionsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Atomic transition + status event + optional notification.
   * Uses SELECT ... FOR UPDATE so concurrent workers cannot race.
   */
  async transition(applicationId: string, to: ApplicationState, opts: TransitionOptions = {}) {
    return this.prisma.$transaction(async (tx) => {
      const [app] = await tx.$queryRaw<
        { id: string; state: ApplicationState; userId: string }[]
      >`SELECT id, state, "userId" FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;

      if (!app) throw new Error(`Application ${applicationId} not found`);

      try {
        assertCanTransition(app.state, to);
      } catch (e) {
        if (e instanceof IllegalStateTransitionError) {
          this.logger.warn(`Rejected transition ${e.from} -> ${e.to} for ${applicationId}`);
          throw e;
        }
        throw e;
      }

      const now = new Date();
      const data: Record<string, unknown> = { state: to };
      if (to === 'SUBMITTED') data.submittedAt = now;
      if (to === 'CONFIRMED') data.confirmedAt = now;
      if (opts.providerRefId) data.providerRefId = opts.providerRefId;
      if (opts.confirmationEvidence) data.confirmationEvidence = opts.confirmationEvidence;
      if (opts.lastError !== undefined) {
        data.lastError = opts.lastError;
        data.lastErrorAt = opts.lastError ? now : null;
      }

      await tx.application.update({ where: { id: applicationId }, data });

      await tx.applicationStatusEvent.create({
        data: {
          applicationId,
          fromState: app.state,
          toState: to,
          note: opts.note,
          metadata: opts.metadata as any,
        },
      });

      if (USER_NOTIFY_STATES.includes(to)) {
        await this.createNotification(tx, app.userId, applicationId, to, opts);
      }

      if (opts.withinTx) await opts.withinTx(tx);

      return { from: app.state, to };
    });
  }

  private async createNotification(
    tx: any,
    userId: string,
    applicationId: string,
    state: ApplicationState,
    opts: TransitionOptions,
  ) {
    const templates: Partial<Record<ApplicationState, { type: string; title: string }>> = {
      AWAITING_APPROVAL: { type: 'AWAITING_APPROVAL', title: 'Application ready for review' },
      SUBMITTED: { type: 'SUBMITTED', title: 'Application submitted' },
      CONFIRMED: { type: 'CONFIRMED', title: 'Application confirmed' },
      FAILED: { type: 'FAILED', title: 'Application failed' },
      NEEDS_USER_INPUT: { type: 'NEEDS_USER_INPUT', title: 'Application needs your input' },
      MANUAL_APPLICATION_REQUIRED: {
        type: 'MANUAL_APPLICATION_REQUIRED',
        title: 'Manual application required',
      },
    };
    const template = templates[state];
    if (!template) return;
    await tx.notification.create({
      data: {
        userId,
        type: template.type,
        title: template.title,
        body: opts.note ?? template.title,
        metadata: { applicationId, ...(opts.metadata ?? {}) },
      },
    });
  }
}
