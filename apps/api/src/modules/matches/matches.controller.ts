import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MatchesService } from './matches.service';

function toInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

@ApiTags('matches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'matches', version: '1' })
export class MatchesController {
  constructor(private matches: MatchesService) {}

  @Get()
  list(@Req() req: any, @Query() query: Record<string, string | undefined>) {
    return this.matches.list(req.user.userId, {
      minScore: toInt(query.minScore),
      page: toInt(query.page),
      pageSize: toInt(query.pageSize),
    });
  }

  @Get(':jobId')
  getForJob(@Req() req: any, @Param('jobId') jobId: string) {
    return this.matches.getForJob(req.user.userId, jobId);
  }
}
