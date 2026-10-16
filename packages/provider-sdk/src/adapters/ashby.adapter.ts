import {
  JobProvider,
  ProviderCapabilities,
  ProviderSearchQuery,
  ProviderSearchResult,
  NormalizedJob,
  ProviderRateLimitError,
} from '../types';
import { inferWorkArrangement, mapEmploymentType } from './mapping';

interface AshbyAddress {
  address?: string | null;
  countryCode?: string | null;
  country?: string | null;
  city?: string | null;
  postalCode?: string | null;
  region?: string | null;
}

interface AshbyRaw {
  id?: string;
  title?: string;
  department?: string | null;
  team?: string | null;
  employmentType?: string | null;
  location?: { remote?: boolean; address?: AshbyAddress | null } | null;
  secondaryLocations?: Array<AshbyAddress | null> | null;
  descriptionHtml?: string;
  applyUrl?: string;
  publishedAt?: string;
}

interface AshbyResponse {
  jobs?: AshbyRaw[];
  morePages?: boolean;
  applyingUrlPattern?: string;
}

/**
 * Ashby job board API. The org slug is public (it is embedded in the
 * employer's careers site). Returns the full board in one response.
 */
export class AshbyAdapter implements JobProvider {
  readonly key = 'ashby';
  readonly displayName = 'Ashby (boards)';
  readonly capabilities: ProviderCapabilities = {
    searchJobs: true,
    retrieveJobDetails: true,
    submitApplications: false,
    verifySubmission: false,
    supportsPagination: false,
    requiresCredentials: false,
    requiresEmployerAuthorization: false,
    accessMode: 'PUBLIC_API',
  };

  private readonly baseUrl = 'https://api.ashbyhq.com';

  constructor(private org: string) {}

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/posting-api/job-board/${this.org}`);
      if (res.status === 404) return { available: false, reason: 'Org board not found' };
      if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
      return { available: true };
    } catch (e) {
      return { available: false, reason: (e as Error).message };
    }
  }

  async searchJobs(_q: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const res = await fetch(`${this.baseUrl}/posting-api/job-board/${this.org}`);
    if (res.status === 429) throw new ProviderRateLimitError(this.key);
    if (!res.ok) throw new Error(`ASHBY_HTTP_${res.status}`);

    const data = (await res.json()) as AshbyResponse;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    return { jobs: jobs.map((r) => this.normalize(r)), totalEstimate: jobs.length };
  }

  private normalize(raw: AshbyRaw): NormalizedJob {
    const address = raw.location?.address;
    const locationName = address?.address ?? address?.city ?? 'Remote';
    const secondary = (raw.secondaryLocations ?? []).filter(Boolean) as AshbyAddress[];

    const allLocations = secondary.map((s) => s?.address ?? s?.city).filter(Boolean) as string[];
    const locationLabel = [locationName, ...allLocations].join(', ');

    return {
      providerKey: this.key,
      externalId: String(raw.id ?? ''),
      title: raw.title ?? 'Unknown position',
      employer: this.org,
      description: stripHtml(raw.descriptionHtml ?? ''),
      location: this.parseLocation(locationLabel),
      workArrangement:
        raw.location?.remote || /^remote$/i.test(locationName)
          ? 'REMOTE'
          : inferWorkArrangement(locationLabel),
      employmentType: mapEmploymentType(raw.employmentType),
      sourceUrl: raw.applyUrl ?? `https://jobs.ashbyhq.com/${this.org}`,
      applyUrl: raw.applyUrl,
      publishedAt: raw.publishedAt,
      attribution: `${this.org} via Ashby`,
      usageRestrictions: [
        'Ashby terms apply; do not automate submission to employers that forbid it.',
      ],
    };
  }

  private parseLocation(name: string): { city?: string; region?: string; country?: string } {
    if (!name) return {};
    if (/remote|anywhere|worldwide/i.test(name)) return { country: 'REMOTE', region: name };
    const parts = name.split(',').map((s) => s.trim());
    return parts.length >= 2
      ? { city: parts[0], region: parts[1], country: parts[parts.length - 1] }
      : { city: parts[0] };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
