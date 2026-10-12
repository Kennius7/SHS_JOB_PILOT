import {
  Controller, Post, Body, Req, UseGuards, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '@shs/data';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

/**
 * Test-only endpoints. The controller is excluded from Swagger and returns
 * 404 unless NODE_ENV !== 'production'. These exist so the e2e smoke script
 * can drive the pipeline without live provider APIs.
 */
@ApiExcludeController()
@ApiTags('admin-test')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller({ path: 'admin/test', version: '1' })
export class AdminTestController {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('match-recent') private matchQueue: Queue,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Test endpoints disabled in production');
    }
  }

  @Post('seed-job')
  async seedJob(@Req() req: any, @Body() body: any) {
    const canonicalKey = createHash('sha256')
      .update(`${body.employer}|${body.title}|${body.city ?? ''}`.toLowerCase())
      .digest('hex')
      .slice(0, 32);

    return this.prisma.job.upsert({
      where: { canonicalKey },
      create: {
        providerKey: body.providerKey ?? 'mock-submission',
        externalId: body.externalId ?? canonicalKey,
        title: body.title,
        employer: body.employer,
        description: body.description ?? 'Seeded test job',
        country: body.country ?? 'NG',
        state: body.state ?? 'LAGOS',
        city: body.city,
        workArrangement: body.workArrangement ?? 'HYBRID',
        employmentType: body.employmentType ?? 'FULL_TIME',
        salaryMin: body.salaryMin,
        salaryMax: body.salaryMax,
        salaryCurrency: body.salaryCurrency ?? 'NGN',
        requiredSkills: body.requiredSkills ?? [],
        preferredSkills: body.preferredSkills ?? [],
        sourceUrl: body.sourceUrl ?? 'https://example.test/job',
        applyUrl: body.applyUrl,
        canonicalKey,
        discoveredBy: 'admin-test-seed',
      },
      update: { lastSeenAt: new Date() },
    });
  }

  @Post('trigger-match-recent')
  async triggerMatchRecent(@Req() req: any, @Body() body: { userId?: string }) {
    const userId = body.userId ?? req.user.userId;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.matchQueue.add(
      'manual',
      { userId, since: since.toISOString() },
      { jobId: `manual-${userId}-${Date.now()}` },
    );
    return { enqueued: true, userId };
  }

  @Post('reset-mock-provider')
  async resetMockProvider() {
    // The mock provider is a singleton per worker process; this endpoint
    // just signals intent. To actually reset, restart the worker or
    // add a dedicated control queue. For now, this is a no-op for
    // situations that don't need deterministic state.
    return { reset: true, note: 'Restart the worker to fully reset mock state' };
  }
}
