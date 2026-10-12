import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

function makePrisma() {
  return {
    notification: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  } as any;
}

describe('NotificationsService', () => {
  let prisma: any;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new NotificationsService(prisma);
  });

  it('lists notifications with an unread count', async () => {
    prisma.notification.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);

    const result = await service.list('u1', {});

    expect(result.total).toBe(2);
    expect(result.unreadCount).toBe(1);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('adds a readAt filter when unreadOnly is set', async () => {
    prisma.notification.count.mockResolvedValue(0);
    prisma.notification.findMany.mockResolvedValue([]);

    await service.list('u1', { unreadOnly: true });

    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.readAt).toBeNull();
  });

  it('prevents reading another user notification', async () => {
    prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'other' });
    await expect(service.markRead('u1', 'n1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws when the notification is missing', async () => {
    prisma.notification.findUnique.mockResolvedValue(null);
    await expect(service.markRead('u1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks all unread notifications as read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const result = await service.markAllRead('u1');
    expect(result).toEqual({ updated: 3 });
  });
});
