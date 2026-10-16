import { Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AdminOpsService } from './admin-ops.service';
import { DbExplorerService } from './db-explorer.service';
import { RedisExplorerService } from './redis-explorer.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller({ path: 'admin', version: '1' })
export class AdminOpsController {
  constructor(
    private admin: AdminOpsService,
    private db: DbExplorerService,
    private redis: RedisExplorerService,
  ) {}

  @Get('providers')
  providers() {
    return this.admin.providers();
  }

  @Get('queues')
  queues() {
    return this.admin.queues();
  }

  @Get('health')
  health() {
    return this.admin.health();
  }

  @Get('audit')
  audit(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
  ) {
    const p = Math.max(1, Number(page ?? '1') || 1);
    const l = Math.min(100, Math.max(1, Number(limit ?? '25') || 25));
    return this.admin.audit({ page: p, limit: l, action: action || undefined });
  }

  @Post('providers/:key/sync')
  triggerSync(@Req() req: Request, @Param('key') key: string) {
    const u = (req as any).user;
    return this.admin.triggerSync(key, u?.userId, req.ip);
  }

  @Get('workers')
  workers() {
    return this.admin.workers();
  }

  @Get('db/tables')
  dbTables() {
    return this.db.tables();
  }

  @Get('db/tables/:table/rows')
  dbRows(
    @Param('table') table: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('orderBy') orderBy?: string,
    @Query('order') order?: string,
    @Query('q') q?: string,
  ) {
    const p = Math.max(1, Number(page ?? '1') || 1);
    const l = Math.min(200, Math.max(1, Number(limit ?? '50') || 50));
    return this.db.rows(table, {
      page: p,
      limit: l,
      orderBy: orderBy || undefined,
      order: order === 'desc' ? 'desc' : 'asc',
      q: q?.trim() ? q.trim() : undefined,
    });
  }

  @Get('redis/keys')
  redisKeys(
    @Query('pattern') pattern?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const l = Math.min(500, Math.max(1, Number(limit ?? '100') || 100));
    return this.redis.keys(pattern ?? '*', cursor ?? '0', l);
  }

  @Get('redis/key')
  redisKey(@Query('key') key: string) {
    return this.redis.key(key);
  }
}
