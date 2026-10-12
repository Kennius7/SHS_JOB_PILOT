export type ProviderAccessMode =
  | 'PUBLIC_API'
  | 'AUTHORIZED_API'
  | 'APPROVED_FEED'
  | 'PERMITTED_BROWSER'
  | 'MANUAL_LINK_ONLY';

export interface ProviderCapabilities {
  searchJobs: boolean;
  retrieveJobDetails: boolean;
  submitApplications: boolean;
  verifySubmission: boolean;
  supportsPagination: boolean;
  requiresCredentials: boolean;
  requiresEmployerAuthorization: boolean;
  accessMode: ProviderAccessMode;
}

export interface ProviderStatus {
  enabled: boolean;
  configured: boolean;
  healthy: boolean;
  lastSuccessfulSyncAt?: string;
  lastError?: string;
  lastErrorAt?: string;
}

export type WorkArrangement = 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN';
export type EmploymentType =
  | 'FULL_TIME' | 'PART_TIME' | 'CONTRACT'
  | 'INTERNSHIP' | 'TEMPORARY' | 'UNKNOWN';
export type SalaryPeriod = 'YEAR' | 'MONTH' | 'DAY' | 'HOUR';

export interface NormalizedJob {
  providerKey: string;
  externalId: string;
  title: string;
  employer: string;
  description?: string;
  location?: { city?: string; region?: string; country?: string };
  workArrangement: WorkArrangement;
  employmentType: EmploymentType;
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: SalaryPeriod;
  };
  skills?: string[];
  seniority?: string;
  publishedAt?: string;
  closingAt?: string;
  sourceUrl: string;
  applyUrl?: string;
  attribution?: string;
  usageRestrictions?: string[];
}

export interface ProviderSearchQuery {
  keywords?: string;
  location?: string;
  country?: string;
  remoteOnly?: boolean;
  page?: number;
  pageSize?: number;
  since?: string;
}

export interface ProviderSearchResult {
  jobs: NormalizedJob[];
  nextPage?: number;
  totalEstimate?: number;
}

export interface ProviderJobDetails {
  job: NormalizedJob;
  fullDescription?: string;
}

export interface ProviderApplicationRequest {
  userId: string;
  externalId: string;
  jobUrl: string;
  resumeUrl: string;
  coverLetter?: string;
  formAnswers?: Record<string, string>;
  idempotencyKey: string;
}

export interface ProviderSubmissionResult {
  accepted: boolean;
  providerReferenceId?: string;
  confirmationEvidence?: Record<string, unknown>;
  needsUserInput?: string[];
  error?: { code: string; message: string; retryable: boolean };
}

export interface ProviderVerificationRequest {
  externalId: string;
  providerReferenceId: string;
}

export interface ProviderVerificationResult {
  confirmed: boolean;
  state: 'CONFIRMED' | 'SUBMITTED' | 'UNKNOWN_OUTCOME' | 'FAILED';
  evidence?: Record<string, unknown>;
}

export interface JobProvider {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  checkAvailability(): Promise<{ available: boolean; reason?: string }>;
  searchJobs(query: ProviderSearchQuery): Promise<ProviderSearchResult>;
  getJobDetails?(externalId: string): Promise<ProviderJobDetails | null>;
  submitApplication?(req: ProviderApplicationRequest): Promise<ProviderSubmissionResult>;
  verifySubmission?(req: ProviderVerificationRequest): Promise<ProviderVerificationResult>;
}

export class ProviderRateLimitError extends Error {
  constructor(public providerKey: string) {
    super(`Rate limit exceeded for provider ${providerKey}`);
  }
}

export class ProviderAuthError extends Error {
  constructor(public providerKey: string, message = 'Provider authentication failed') {
    super(message);
  }
}
