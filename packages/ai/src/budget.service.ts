/**
 * Minimal Prisma surface this service needs. Keeping it structural means the
 * package has no hard runtime dependency on @prisma/client and stays testable
 * with a stub.
 */
export interface UsageRecordClient {
  aggregate(args: {
    where: Record<string, unknown>;
    _sum: { amount: true };
  }): Promise<{ _sum: { amount: number | null } }>;
  createMany(args: {
    data: Array<{
      userId: string;
      kind: string;
      amount: number;
      metadata?: Record<string, unknown>;
    }>;
  }): Promise<{ count: number }>;
}

export interface BudgetConfig {
  /** USD. Per-user monthly cap. */
  userMonthlyBudgetUsd: number;
  /** USD. Platform-wide monthly cap. */
  platformMonthlyBudgetUsd: number;
  /** Optional pricing override. Defaults match Gemini 3.7 Flash public pricing. */
  inputCostPer1M?: number;
  outputCostPer1M?: number;
}

export class AiBudgetError extends Error {
  constructor(public code: 'AI_BUDGET_USER_EXCEEDED' | 'AI_BUDGET_PLATFORM_EXCEEDED') {
    super(code);
  }
}

export class AiBudgetService {
  private readonly inputCostPer1M: number;
  private readonly outputCostPer1M: number;

  constructor(
    private prisma: UsageRecordClient,
    private config: BudgetConfig,
  ) {
    this.inputCostPer1M = config.inputCostPer1M ?? 0.75;
    this.outputCostPer1M = config.outputCostPer1M ?? 3.75;
  }

  async checkBudget(userId: string): Promise<void> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [userUsage, platformUsage] = await Promise.all([
      this.prisma.aggregate({
        where: { userId, kind: 'AI_COST', createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.aggregate({
        where: { kind: 'AI_COST', createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
    ]);

    const userSpent = userUsage._sum.amount ?? 0;
    const platformSpent = platformUsage._sum.amount ?? 0;

    if (platformSpent >= this.config.platformMonthlyBudgetUsd) {
      throw new AiBudgetError('AI_BUDGET_PLATFORM_EXCEEDED');
    }
    if (userSpent >= this.config.userMonthlyBudgetUsd) {
      throw new AiBudgetError('AI_BUDGET_USER_EXCEEDED');
    }
  }

  async recordUsage(
    userId: string,
    inputTokens: number,
    outputTokens: number,
    model: string,
  ): Promise<number> {
    const cost =
      (inputTokens / 1_000_000) * this.inputCostPer1M +
      (outputTokens / 1_000_000) * this.outputCostPer1M;

    await this.prisma.createMany({
      data: [
        { userId, kind: 'AI_TOKENS_IN', amount: inputTokens, metadata: { model } },
        { userId, kind: 'AI_TOKENS_OUT', amount: outputTokens, metadata: { model } },
        { userId, kind: 'AI_COST', amount: cost, metadata: { model } },
      ],
    });

    return cost;
  }
}

/** Rough token estimate from character length. Good enough for budget gating. */
export function estimateTokens(input: unknown): number {
  return Math.ceil(String(typeof input === 'string' ? input : JSON.stringify(input)).length / 4);
}
