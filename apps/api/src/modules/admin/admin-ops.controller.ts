import { Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AdminOpsService } from './admin-ops.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller({ path: 'admin', version: '1' })
export class AdminOpsController {
  constructor(private admin: AdminOpsService) {}

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
    return this.admin.triggerSync(key, u?.id, req.ip);
  }
}
