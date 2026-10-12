import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@shs/data';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, opts: { unreadOnly?: boolean; page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.trunc(opts.page ?? 1) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(opts.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
    );

    const where: any = { userId };
    if (opts.unreadOnly) where.readAt = null;

    const [total, items, unreadCount] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { items, total, page, pageSize, unreadCount };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { unreadCount: count };
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.userId !== userId) throw new ForbiddenException();
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: notification.readAt ?? new Date() },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
