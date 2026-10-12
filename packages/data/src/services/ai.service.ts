import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeminiAdapter,
  AiBudgetService,
  estimateTokens,
  type MatchInput,
  type CoverLetterInput,
  type ParsedCv,
  type MatchScore,
} from '@shs/ai';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Runtime AI facade with mock mode. Both the API and the worker use this.
 * In mock mode (no key, or AI_MOCK_MODE=true) returns deterministic data so
 * the pipeline runs end-to-end without any external calls.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private adapter: GeminiAdapter | null = null;
  private budget: AiBudgetService | null = null;
  private readonly mock: boolean;
  private readonly model: string;

  constructor(config: ConfigService, private prisma: PrismaService) {
    this.model = config.get('AI_MODEL', 'gemini-3.8-flash');
    const apiKey = config.get<string>('AI_API_KEY');
    this.mock = !apiKey || config.get('AI_MOCK_MODE') === 'true';

    if (!this.mock && apiKey) {
      this.adapter = new GeminiAdapter(apiKey, this.model);
      this.budget = new AiBudgetService(prisma as any, {
        userMonthlyBudgetUsd: Number(config.get('AI_PER_USER_MONTHLY_BUDGET_USD', 2)),
        platformMonthlyBudgetUsd: Number(config.get('AI_MONTHLY_BUDGET_USD', 25)),
      });
    } else {
      this.logger.warn('AI running in MOCK mode — no real API calls will be made');
    }
  }

  isMock(): boolean {
    return this.mock;
  }

  async parseCv(userId: string, text: string): Promise<ParsedCv> {
    if (this.mock) {
      return {
        fullName: 'Mock Candidate',
        skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
        experience: [{ title: 'Software Engineer', employer: 'Mock Corp' }],
        education: [{ institution: 'Mock University', degree: 'BSc' }],
        yearsExperience: 5,
      };
    }
    await this.budget!.checkBudget(userId);
    const result = await this.adapter!.parseCv(text);
    await this.budget!.recordUsage(userId, estimateTokens(text), 1000, this.model);
    return result;
  }

  async scoreMatch(userId: string, input: MatchInput): Promise<MatchScore> {
    if (this.mock) {
      return {
        overallScore: 75,
        breakdown: { skills: 80, experience: 70, location: 90, salary: 60, roleDirection: 85 },
        missingRequired: [],
        reasons: ['Mock mode: assumed match'],
        hardEligibilityFail: false,
      };
    }
    await this.budget!.checkBudget(userId);
    const result = await this.adapter!.scoreMatch(input);
    await this.budget!.recordUsage(userId, estimateTokens(input), 500, this.model);
    return result;
  }

  async generateCoverLetter(userId: string, input: CoverLetterInput): Promise<string> {
    if (this.mock) {
      return `Dear Hiring Manager,\n\nI am writing to express my interest in the ${input.job.title} position at ${input.job.employer}. [Mock cover letter — enable real AI to generate.]\n\nSincerely,\n${input.profile.fullName ?? 'Candidate'}`;
    }
    await this.budget!.checkBudget(userId);
    const result = await this.adapter!.generateCoverLetter(input);
    await this.budget!.recordUsage(
      userId,
      estimateTokens(input),
      estimateTokens(result),
      this.model,
    );
    return result;
  }
}
