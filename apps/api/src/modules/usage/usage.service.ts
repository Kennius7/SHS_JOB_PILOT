import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shs/data';

@Injectable()
export class UsageService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async summary(userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const grouped = await this.prisma.usageRecord.groupBy({
      by: ['kind'],
      where: { userId, createdAt: { gte: startOfMonth } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const items = grouped.map((g) => ({
      kind: g.kind,
      amount: g._sum.amount ?? 0,
      count: g._count._all,
    }));
    const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);

    return {
      periodStart: startOfMonth,
      items,
      totalAmount,
      budget: {
        perUserMonthlyUsd: Number(this.config.get('AI_PER_USER_MONTHLY_BUDGET_USD', 2)),
        platformMonthlyUsd: Number(this.config.get('AI_MONTHLY_BUDGET_USD', 25)),
      },
    };
  }
}
