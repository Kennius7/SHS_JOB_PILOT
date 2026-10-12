import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
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

  @Post('providers/:key/sync')
  triggerSync(@Param('key') key: string) {
    return this.admin.triggerSync(key);
  }
}
