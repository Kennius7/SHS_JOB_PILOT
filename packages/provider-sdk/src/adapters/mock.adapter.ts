import {
  JobProvider,
  ProviderCapabilities,
  ProviderApplicationRequest,
  ProviderSubmissionResult,
  ProviderVerificationResult,
  ProviderVerificationRequest,
} from '../types';
import { randomUUID } from 'crypto';

interface MockControls {
  outcome: 'accept' | 'reject' | 'needs_input' | 'timeout' | 'rate_limit';
  verifyAfterAttempts: number;
}

/**
 * Test-only provider. Never register in production.
 * Reproduces every submission outcome so the pipeline can be exercised
 * end-to-end without contacting a real provider.
 */
export class MockSubmissionProvider implements JobProvider {
  readonly key = 'mock-submission';
  readonly displayName = 'Mock Provider (test only)';
  readonly capabilities: ProviderCapabilities = {
    searchJobs: false,
    retrieveJobDetails: false,
    submitApplications: true,
    verifySubmission: true,
    supportsPagination: false,
    requiresCredentials: false,
    requiresEmployerAuthorization: false,
    accessMode: 'AUTHORIZED_API',
  };

  private controls: MockControls = { outcome: 'accept', verifyAfterAttempts: 1 };
  private verifyCalls = new Map<string, number>();
  private submissions = new Map<string, { refId: string; idempotencyKey: string }>();

  setControls(c: Partial<MockControls>): void {
    this.controls = { ...this.controls, ...c };
  }

  reset(): void {
    this.verifyCalls.clear();
    this.submissions.clear();
    this.controls = { outcome: 'accept', verifyAfterAttempts: 1 };
  }

  async checkAvailability(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async searchJobs(): Promise<{ jobs: never[] }> {
    return { jobs: [] };
  }

  async submitApplication(req: ProviderApplicationRequest): Promise<ProviderSubmissionResult> {
    // Idempotency: repeated idempotencyKey returns the same refId.
    const existing = [...this.submissions.values()].find(
      (s) => s.idempotencyKey === req.idempotencyKey,
    );
    if (existing) {
      return { accepted: true, providerReferenceId: existing.refId };
    }

    switch (this.controls.outcome) {
      case 'accept': {
        const refId = `mock-${randomUUID()}`;
        this.submissions.set(refId, { refId, idempotencyKey: req.idempotencyKey });
        return { accepted: true, providerReferenceId: refId };
      }
      case 'reject':
        return {
          accepted: false,
          error: { code: 'MOCK_REJECT', message: 'Mock rejected', retryable: false },
        };
      case 'needs_input':
        return { accepted: false, needsUserInput: ['noticePeriod', 'expectedSalary'] };
      case 'timeout':
        throw Object.assign(new Error('Mock timeout'), { code: 'ETIMEDOUT' });
      case 'rate_limit':
        return {
          accepted: false,
          error: { code: 'RATE_LIMIT', message: 'Slow down', retryable: true },
        };
    }
  }

  async verifySubmission({
    providerReferenceId,
  }: ProviderVerificationRequest): Promise<ProviderVerificationResult> {
    const count = (this.verifyCalls.get(providerReferenceId) ?? 0) + 1;
    this.verifyCalls.set(providerReferenceId, count);

    if (count >= this.controls.verifyAfterAttempts) {
      return {
        confirmed: true,
        state: 'CONFIRMED',
        evidence: { verifiedAt: new Date().toISOString(), attempt: count },
      };
    }
    return { confirmed: false, state: 'UNKNOWN_OUTCOME' };
  }
}
