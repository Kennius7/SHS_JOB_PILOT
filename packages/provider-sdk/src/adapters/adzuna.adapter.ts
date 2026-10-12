import {
  JobProvider,
  ProviderCapabilities,
  ProviderSearchQuery,
  ProviderSearchResult,
  NormalizedJob,
  WorkArrangement,
  EmploymentType,
  SalaryPeriod,
  ProviderRateLimitError,
  ProviderAuthError,
} from '../types';

interface AdzunaRaw {
  id: string;
  title: string;
  description: string;
  created: string;
  redirect_url: string;
  company?: { display_name?: string };
  location?: { area?: string[]; display_name?: string };
  salary_min?: number;
  salary_max?: number;
  contract_time?: string;
  contract_type?: string;
  category?: { label?: string };
}

export class AdzunaAdapter implements JobProvider {
  readonly key = 'adzuna';
  readonly displayName = 'Adzuna';
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

  private readonly baseUrl = 'https://api.adzuna.com/v1/api/jobs';
  private readonly country: string;

  constructor(
    private appId: string,
    private appKey: string,
    country = 'ng',
  ) {
    this.country = country;
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const url = new URL(`${this.baseUrl}/${this.country}/search/1`);
      url.searchParams.set('app_id', this.appId);
      url.searchParams.set('app_key', this.appKey);
      url.searchParams.set('results_per_page', '1');

      const res = await fetch(url.toString());
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
    const pageSize = Math.min(q.pageSize ?? 50, 50);
    const url = new URL(`${this.baseUrl}/${this.country}/search/${page}`);

    url.searchParams.set('app_id', this.appId);
    url.searchParams.set('app_key', this.appKey);
    url.searchParams.set('results_per_page', String(pageSize));
    if (q.keywords) url.searchParams.set('what', q.keywords);
    if (q.location) url.searchParams.set('where', q.location);
    if (q.remoteOnly) url.searchParams.set('what_and', 'remote');

    const res = await fetch(url.toString());

    if (res.status === 429) throw new ProviderRateLimitError(this.key);
    if (res.status === 401 || res.status === 403) throw new ProviderAuthError(this.key);
    if (!res.ok) throw new Error(`ADZUNA_HTTP_${res.status}`);

    const data = (await res.json()) as { results: AdzunaRaw[]; count: number };

    return {
      jobs: data.results.map((r) => this.normalize(r)),
      nextPage: data.results.length === pageSize ? page + 1 : undefined,
      totalEstimate: data.count,
    };
  }

  private normalize(raw: AdzunaRaw): NormalizedJob {
    return {
      providerKey: this.key,
      externalId: raw.id,
      title: raw.title,
      employer: raw.company?.display_name ?? 'Unknown',
      description: raw.description,
      location: {
        country: this.country.toUpperCase(),
        region: raw.location?.area?.[1],
        city: raw.location?.area?.[2],
      },
      workArrangement: this.inferWorkArrangement(raw),
      employmentType: this.mapEmploymentType(raw.contract_time, raw.contract_type),
      salary:
        raw.salary_min != null && raw.salary_max != null
          ? {
              min: Math.round(raw.salary_min),
              max: Math.round(raw.salary_max),
              currency: 'NGN',
              period: 'YEAR' as SalaryPeriod,
            }
          : undefined,
      sourceUrl: raw.redirect_url,
      applyUrl: raw.redirect_url,
      publishedAt: raw.created,
      attribution: 'Jobs by Adzuna',
      usageRestrictions: [
        'Attribution required: display "Jobs by Adzuna" badge (min 116x23 px)',
      ],
    };
  }

  private inferWorkArrangement(raw: AdzunaRaw): WorkArrangement {
    const text = `${raw.title} ${raw.description}`.toLowerCase();
    if (text.includes('remote')) return 'REMOTE';
    if (text.includes('hybrid')) return 'HYBRID';
    return 'UNKNOWN';
  }

  private mapEmploymentType(contractTime?: string, contractType?: string): EmploymentType {
    if (contractType === 'contract') return 'CONTRACT';
    if (contractType === 'internship') return 'INTERNSHIP';
    if (contractTime === 'full_time') return 'FULL_TIME';
    if (contractTime === 'part_time') return 'PART_TIME';
    return 'UNKNOWN';
  }
}
