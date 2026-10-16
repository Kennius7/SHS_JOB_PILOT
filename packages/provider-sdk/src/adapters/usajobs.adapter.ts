import {
  JobProvider,
  ProviderCapabilities,
  ProviderSearchQuery,
  ProviderSearchResult,
  NormalizedJob,
  ProviderRateLimitError,
  ProviderAuthError,
  SalaryPeriod,
} from '../types';
import { inferWorkArrangement, mapEmploymentType } from './mapping';

interface UsaJobsDescriptor {
  PositionID?: string;
  PositionTitle?: string;
  PositionURI?: string;
  PositionLocation?: Array<{ LocationName?: string; CountryCode?: string }>;
  OrganizationName?: string;
  PositionRemuneration?: Array<{
    MinimumRange?: number;
    MaximumRange?: number;
    RateIntervalCode?: string;
  }>;
  PositionSchedule?: Array<{ Name?: string }>;
  PositionOfferingType?: Array<{ Name?: string }>;
  QualificationSummary?: string;
  JobSummary?: string;
  PublicationStartDate?: string;
  ApplyURI?: string[];
  RemoteIndicator?: boolean;
  WorkSchedule?: string;
}

interface UsaJobsItem {
  MatchedObjectDescriptor?: UsaJobsDescriptor;
}

interface UsaJobsResponse {
  SearchResult?: {
    SearchResultCount?: number;
    SearchResultItems?: UsaJobsItem[];
  };
}

/**
 * USAJOBS requires three request headers (Host, User-Agent set to the caller's
 * email, and Authorization-Key). Results are US federal positions; useful for
 * overseas/Nigerian nationals eligible for federal hiring, and pulls in remote
 * US roles.
 */
export class UsaJobsAdapter implements JobProvider {
  readonly key = 'usajobs';
  readonly displayName = 'USAJOBS';
  readonly capabilities: ProviderCapabilities = {
    searchJobs: true,
    retrieveJobDetails: true,
    submitApplications: false,
    verifySubmission: false,
    supportsPagination: true,
    requiresCredentials: true,
    requiresEmployerAuthorization: false,
    accessMode: 'PUBLIC_API',
  };

  private readonly baseUrl = 'https://data.usajobs.gov/api/search';

  constructor(
    private apiKey: string,
    private email: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      Host: 'data.usajobs.gov',
      'User-Agent': `shs-job-pilot <${this.email}>`,
      'Authorization-Key': this.apiKey,
      'Accept-Encoding': 'gzip, deflate',
    };
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}?ResultsPerPage=1`, { headers: this.headers() });
      if (res.status === 401 || res.status === 403) {
        return { available: false, reason: `Authentication failed (HTTP ${res.status})` };
      }
      if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
      return { available: true };
    } catch (e) {
      return { available: false, reason: (e as Error).message };
    }
  }

  async searchJobs(q: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 500);
    const url = new URL(this.baseUrl);

    if (q.keywords) url.searchParams.set('Keyword', q.keywords);
    if (q.location) url.searchParams.set('LocationName', q.location);
    if (q.remoteOnly) url.searchParams.set('RemoteIndicator', 'True');
    url.searchParams.set('ResultsPerPage', String(pageSize));
    url.searchParams.set('Page', String(page));

    const res = await fetch(url.toString(), { headers: this.headers() });
    if (res.status === 429) throw new ProviderRateLimitError(this.key);
    if (res.status === 401 || res.status === 403) throw new ProviderAuthError(this.key);
    if (!res.ok) throw new Error(`USAJOBS_HTTP_${res.status}`);

    const data = (await res.json()) as UsaJobsResponse;
    const items = data.SearchResult?.SearchResultItems ?? [];

    return {
      jobs: items
        .map((item) => item.MatchedObjectDescriptor)
        .filter((d): d is UsaJobsDescriptor => !!d)
        .map((d) => this.normalize(d)),
      nextPage: items.length === pageSize ? page + 1 : undefined,
      totalEstimate: data.SearchResult?.SearchResultCount,
    };
  }

  private normalize(d: UsaJobsDescriptor): NormalizedJob {
    const remuneration = d.PositionRemuneration?.[0];
    const schedule = d.PositionSchedule?.[0]?.Name ?? d.WorkSchedule;
    const location = d.PositionLocation?.[0];

    return {
      providerKey: this.key,
      externalId: String(d.PositionID ?? d.PositionURI ?? ''),
      title: d.PositionTitle ?? 'Unknown position',
      employer: d.OrganizationName ?? 'U.S. Federal Government',
      description: d.JobSummary ?? d.QualificationSummary,
      location: {
        city: location?.LocationName,
        country: location?.CountryCode ?? 'US',
      },
      workArrangement: d.RemoteIndicator
        ? 'REMOTE'
        : inferWorkArrangement(`${d.PositionTitle ?? ''} ${d.JobSummary ?? ''}`),
      employmentType: mapEmploymentType(schedule),
      salary:
        remuneration && remuneration.MinimumRange != null
          ? {
              min: Math.round(remuneration.MinimumRange),
              max:
                remuneration.MaximumRange != null
                  ? Math.round(remuneration.MaximumRange)
                  : undefined,
              currency: 'USD',
              period: mapRateInterval(remuneration.RateIntervalCode),
            }
          : undefined,
      sourceUrl: d.PositionURI ?? '',
      applyUrl: d.ApplyURI?.[0] ?? d.PositionURI,
      publishedAt: d.PublicationStartDate,
      attribution: 'USAJOBS',
      usageRestrictions: [
        'USAJOBS requires attribution and prohibits commercial redistribution of full listing text.',
      ],
    };
  }
}

function mapRateInterval(code?: string): SalaryPeriod | undefined {
  switch (code) {
    case 'PA':
      return 'YEAR';
    case 'PM':
    case 'PP':
      return 'MONTH';
    case 'PH':
      return 'HOUR';
    default:
      return undefined;
  }
}
