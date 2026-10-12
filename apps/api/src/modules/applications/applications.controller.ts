import {
  Controller, Get, Post, Param, Body, Query, Req, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApplicationsService, TransitionsService } from '@shs/data';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplicationState } from '@shs/shared';

@ApiTags('applications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'applications', version: '1' })
export class ApplicationsController {
  constructor(
    private applications: ApplicationsService,
    private transitions: TransitionsService,
    @InjectQueue('application-submission') private submissionQueue: Queue,
  ) {}

  @Get()
  list(@Req() req: any, @Query('state') state?: ApplicationState) {
    return this.applications.list(req.user.userId, state);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.applications.get(req.user.userId, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Req() req: any, @Param('id') id: string) {
    const result = await this.applications.approve(req.user.userId, id);
    // Wake the submission worker immediately.
    await this.submissionQueue.add(
      'submit',
      { applicationId: id },
      { attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
    );
    return result;
  }

  @Post(':id/skip')
  @HttpCode(200)
  skip(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.applications.skip(req.user.userId, id, body?.reason);
  }

  @Post(':id/verify')
  @HttpCode(200)
  async verify(@Req() req: any, @Param('id') id: string) {
    // User-triggered verification: emits an event, doesn't re-submit.
    const app = await this.applications.get(req.user.userId, id);
    if (app.state !== 'SUBMITTED' && app.state !== 'UNKNOWN_OUTCOME') {
      return { skipped: `state=${app.state}` };
    }
    return { queued: true, state: app.state };
  }
}
