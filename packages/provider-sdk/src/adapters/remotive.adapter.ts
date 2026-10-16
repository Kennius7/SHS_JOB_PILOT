import {
  JobProvider,
  ProviderCapabilities,
  ProviderSearchQuery,
  ProviderSearchResult,
  NormalizedJob,
  ProviderRateLimitError,
} from '../types';
import { inferWorkArrangement, mapEmploymentType, parseSalaryRange } from './mapping';

interface RemotiveRaw {
  id: number | string;
  url: string;
  title: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

interface RemotiveResponse {
  jobs?: RemotiveRaw[];
  'job-count'?: number;
  total?: string;
}

export class RemotiveAdapter implements JobProvider {
  readonly key = 'remotive';
  readonly displayName = 'Remotive';
  readonly capabilities: ProviderCapabilities = {
    searchJobs: true,
    retrieveJobDetails: true,
    submitApplications: false,
    verifySubmission: false,
    supportsPagination: true,
    requiresCredentials: false,
    requiresEmployerAuthorization: false,
    accessMode: 'PUBLIC_API',
  };

  private readonly baseUrl = 'https://remotive.com/api/jobs';

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}?limit=1`);
      if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
      return { available: true };
    } catch (e) {
      return { available: false, reason: (e as Error).message };
    }
  }

  async searchJobs(q: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const page = q.page ?? 1;
    const url = new URL(this.baseUrl);
    if (q.keywords) url.searchParams.set('search', q.keywords);
    if (q.location) url.searchParams.set('location', q.location);
    url.searchParams.set('page', String(page));

    const res = await fetch(url.toString());
    if (res.status === 429) throw new ProviderRateLimitError(this.key);
    if (!res.ok) throw new Error(`REMOTIVE_HTTP_${res.status}`);

    const data = (await res.json()) as RemotiveResponse;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    const total = Number(data.total);
    return {
      jobs: jobs.map((r) => this.normalize(r)),
      nextPage: jobs.length > 0 ? page + 1 : undefined,
      totalEstimate: Number.isFinite(total) ? total : data['job-count'],
    };
  }

  private normalize(raw: RemotiveRaw): NormalizedJob {
    const location = raw.candidate_required_location ?? '';
    const salary = parseSalaryRange(raw.salary);
    return {
      providerKey: this.key,
      externalId: String(raw.id),
      title: raw.title,
      employer: raw.company_name ?? 'Unknown',
      description: raw.description,
      location: this.parseLocation(location),
      workArrangement: /worldwide|remote/i.test(location)
        ? 'REMOTE'
        : inferWorkArrangement(location),
      employmentType: mapEmploymentType(raw.job_type),
      salary,
      skills: raw.tags,
      sourceUrl: raw.url,
      applyUrl: raw.url,
      publishedAt: raw.publication_date,
      attribution: 'Jobs by Remotive',
      usageRestrictions: ['Attribution required on listings sourced from Remotive.'],
    };
  }

  private parseLocation(location: string): { city?: string; region?: string; country?: string } {
    if (!location) return {};
    if (/worldwide|remote|anywhere/i.test(location)) return { country: 'REMOTE' };
    const parts = location.split(',').map((s) => s.trim());
    return parts.length >= 2 ? { city: parts[0], region: parts[1] } : { city: parts[0] };
  }
}
