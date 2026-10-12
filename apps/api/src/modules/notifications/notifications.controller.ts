import {
  Controller, Get, Post, Param, Query, Req, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

function toInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@Req() req: any, @Query() query: Record<string, string | undefined>) {
    return this.notifications.list(req.user.userId, {
      unreadOnly: query.unreadOnly === 'true' || query.unreadOnly === '1',
      page: toInt(query.page),
      pageSize: toInt(query.pageSize),
    });
  }

  @Get('unread-count')
  unreadCount(@Req() req: any) {
    return this.notifications.unreadCount(req.user.userId);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@Req() req: any) {
    return this.notifications.markAllRead(req.user.userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.notifications.markRead(req.user.userId, id);
  }
}
