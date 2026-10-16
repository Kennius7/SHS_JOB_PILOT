import {
  JobProvider,
  ProviderCapabilities,
  ProviderSearchQuery,
  ProviderSearchResult,
  NormalizedJob,
  ProviderRateLimitError,
} from '../types';
import { inferWorkArrangement, mapEmploymentType } from './mapping';

interface GreenhouseLocation {
  name?: string;
}

interface GreenhouseMetadataItem {
  id?: number;
  name?: string;
  value?: string | Array<{ name?: string }>;
}

interface GreenhouseRaw {
  id?: number;
  title?: string;
  location?: GreenhouseLocation;
  absolute_url?: string;
  updated_at?: string;
  content?: string;
  metadata?: GreenhouseMetadataItem[];
  offices?: Array<{ name?: string }>;
}

interface GreenhouseResponse {
  jobs?: GreenhouseRaw[];
  meta?: { total?: number };
}

/**
 * Greenhouse job board. Reads a single employer board and returns its active
 * postings. The board token is public (it is embedded in the employer's own
 * careers page).
 */
export class GreenhouseAdapter implements JobProvider {
  readonly key = 'greenhouse';
  readonly displayName = 'Greenhouse (boards)';
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

  private readonly baseUrl = 'https://boards-api.greenhouse.io/v1/boards';

  constructor(private boardToken: string) {}

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/${this.boardToken}/jobs`);
      if (res.status === 404) return { available: false, reason: 'Board not found' };
      if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
      return { available: true };
    } catch (e) {
      return { available: false, reason: (e as Error).message };
    }
  }

  async searchJobs(q: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const page = q.page ?? 1;
    const url = new URL(`${this.baseUrl}/${this.boardToken}/jobs`);
    url.searchParams.set('content', 'true');
    url.searchParams.set('page', String(page));

    const res = await fetch(url.toString());
    if (res.status === 429) throw new ProviderRateLimitError(this.key);
    if (!res.ok) throw new Error(`GREENHOUSE_HTTP_${res.status}`);

    const data = (await res.json()) as GreenhouseResponse;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    return {
      jobs: jobs.map((r) => this.normalize(r)),
      nextPage: jobs.length > 0 ? page + 1 : undefined,
      totalEstimate: data.meta?.total,
    };
  }

  private normalize(raw: GreenhouseRaw): NormalizedJob {
    const locationName = raw.location?.name ?? raw.offices?.[0]?.name ?? '';
    const employmentType = this.metadataValue(raw.metadata, 'Employment Type');
    const workArrangement = this.metadataValue(raw.metadata, 'Work Arrangement');

    return {
      providerKey: this.key,
      externalId: String(raw.id ?? ''),
      title: raw.title ?? 'Unknown position',
      employer: this.boardToken.toUpperCase().replace(/-/g, ' '),
      description: stripHtml(raw.content ?? ''),
      location: this.parseLocation(locationName),
      workArrangement: inferWorkArrangement(locationName, workArrangement),
      employmentType: mapEmploymentType(employmentType),
      sourceUrl: raw.absolute_url ?? `https://boards.greenhouse.io/${this.boardToken}`,
      applyUrl: raw.absolute_url,
      publishedAt: raw.updated_at,
      attribution: `${this.boardToken} via Greenhouse`,
      usageRestrictions: [
        'Greenhouse terms apply; do not automate submission to employers that forbid it.',
      ],
    };
  }

  private metadataValue(
    metadata: GreenhouseMetadataItem[] | undefined,
    name: string,
  ): string | undefined {
    const item = metadata?.find((m) => m.name?.toLowerCase() === name.toLowerCase());
    if (!item) return undefined;
    if (Array.isArray(item.value))
      return item.value
        .map((v) => v.name)
        .filter(Boolean)
        .join(', ');
    return item.value;
  }

  private parseLocation(name: string): { city?: string; region?: string; country?: string } {
    if (!name) return {};
    if (/remote|anywhere/i.test(name)) return { country: 'REMOTE', region: name };
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
