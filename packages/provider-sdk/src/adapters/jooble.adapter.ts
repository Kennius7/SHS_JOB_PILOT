import {
  JobProvider,
  ProviderCapabilities,
  ProviderSearchQuery,
  ProviderSearchResult,
  NormalizedJob,
  ProviderRateLimitError,
  ProviderAuthError,
} from '../types';
import { inferWorkArrangement, mapEmploymentType, parseSalaryRange } from './mapping';

interface JoobleRaw {
  id: string | number;
  title: string;
  location?: string;
  snippet: string;
  salary?: string;
  source?: string;
  type?: string;
  link: string;
  updated?: string;
  company?: string;
}

interface JoobleResponse {
  totalCount: number;
  jobs: JoobleRaw[];
}

export class JoobleAdapter implements JobProvider {
  readonly key = 'jooble';
  readonly displayName = 'Jooble';
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

  private readonly baseUrl = 'https://jooble.org/api';

  constructor(private apiKey: string, private country = 'ng') {}

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: 'engineer', page: 1 }),
      });
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
    const url = `${this.baseUrl}/${this.apiKey}`;

    const body: Record<string, unknown> = {
      keywords: q.keywords ?? '',
      page,
    };
    if (q.location) body.location = q.location;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 429) throw new ProviderRateLimitError(this.key);
    if (res.status === 401 || res.status === 403) throw new ProviderAuthError(this.key);
    if (!res.ok) throw new Error(`JOOBLE_HTTP_${res.status}`);

    const data = (await res.json()) as JoobleResponse;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    return {
      jobs: jobs.map((r) => this.normalize(r)),
      nextPage: jobs.length > 0 ? page + 1 : undefined,
      totalEstimate: data.totalCount,
    };
  }

  private normalize(raw: JoobleRaw): NormalizedJob {
    const salary = parseSalaryRange(raw.salary);
    return {
      providerKey: this.key,
      externalId: String(raw.id),
      title: raw.title,
      employer: raw.company ?? 'Unknown',
      description: raw.snippet,
      location: this.parseLocation(raw.location ?? ''),
      workArrangement: inferWorkArrangement(raw.snippet),
      employmentType: mapEmploymentType(raw.type),
      salary,
      sourceUrl: raw.link,
      applyUrl: raw.link,
      publishedAt: raw.updated,
      attribution: 'Jobs by Jooble',
      usageRestrictions: ['Attribution required on listings sourced from Jooble.'],
    };
  }

  private parseLocation(location: string): { city?: string; region?: string; country?: string } {
    if (!location) return {};
    const parts = location.split(',').map((s) => s.trim());
    if (parts.length >= 2) {
      return { city: parts[0], region: parts[1], country: parts[parts.length - 1] };
    }
    return { city: parts[0] };
  }
}