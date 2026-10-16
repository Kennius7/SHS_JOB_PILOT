import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JobsService } from './jobs.service';

function toInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function toBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true' || value === '1';
}

@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'jobs', version: '1' })
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Get()
  search(@Req() req: any, @Query() query: Record<string, string | undefined>) {
    return this.jobs.search(req.user.userId, {
      q: query.q,
      state: query.state,
      workArrangement: query.workArrangement,
      employmentType: query.employmentType,
      providerKey: query.providerKey,
      remoteOnly: toBool(query.remoteOnly),
      salaryMin: toInt(query.salaryMin),
      page: toInt(query.page),
      pageSize: toInt(query.pageSize),
    });
  }

  @Get('saved')
  listSaved(@Req() req: any) {
    return this.jobs.listSaved(req.user.userId);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.jobs.get(req.user.userId, id);
  }

  @Post(':id/save')
  @HttpCode(200)
  save(@Req() req: any, @Param('id') id: string) {
    return this.jobs.save(req.user.userId, id);
  }

  @Delete(':id/save')
  unsave(@Req() req: any, @Param('id') id: string) {
    return this.jobs.unsave(req.user.userId, id);
  }
}
