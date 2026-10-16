import {
  JobProvider,
  ProviderCapabilities,
  ProviderSearchQuery,
  ProviderSearchResult,
  NormalizedJob,
  ProviderRateLimitError,
} from '../types';
import { inferWorkArrangement } from './mapping';

interface RemoteOkMeta {
  success?: boolean;
  source?: string;
}

interface RemoteOkRaw {
  id?: string;
  slug?: string;
  company?: string;
  title?: string;
  description?: string;
  date?: string;
  tags?: string[];
  location?: string;
  url?: string;
  apply_url?: string;
  company_logo?: string;
}

type RemoteOkResponse = (RemoteOkMeta | RemoteOkRaw)[];

/**
 * Remote OK exposes a single endpoint with every listing (no server-side
 * pagination). Keyword filtering happens client-side on title, company, tags
 * and description, which keeps results relevant without paging the API.
 */
export class RemoteOkAdapter implements JobProvider {
  readonly key = 'remoteok';
  readonly displayName = 'Remote OK';
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

  private readonly baseUrl = 'https://remoteok.com/api';

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const res = await fetch(this.baseUrl);
      if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
      return { available: true };
    } catch (e) {
      return { available: false, reason: (e as Error).message };
    }
  }

  async searchJobs(q: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const res = await fetch(this.baseUrl);
    if (res.status === 429) throw new ProviderRateLimitError(this.key);
    if (!res.ok) throw new Error(`REMOTEOK_HTTP_${res.status}`);

    const data = (await res.json()) as RemoteOkResponse;
    const rawJobs = Array.isArray(data) ? data.filter((d): d is RemoteOkRaw => isJob(d)) : [];

    const keyword = q.keywords?.toLowerCase();
    const jobs = keyword ? rawJobs.filter((raw) => this.matchesKeyword(raw, keyword)) : rawJobs;

    return { jobs: jobs.map((r) => this.normalize(r)) };
  }

  private matchesKeyword(raw: RemoteOkRaw, keyword: string): boolean {
    const haystack = [raw.title, raw.company, raw.description, ...(raw.tags ?? [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(keyword);
  }

  private normalize(raw: RemoteOkRaw): NormalizedJob {
    const desc = raw.description ?? '';
    const title = raw.title ?? '';
    const location = raw.location ?? 'Worldwide';

    return {
      providerKey: this.key,
      externalId: String(raw.id ?? raw.slug ?? `${raw.company}-${raw.title}`),
      title,
      employer: raw.company ?? 'Unknown',
      description: stripHtml(desc),
      location: { country: 'REMOTE', region: 'Worldwide' },
      workArrangement:
        /remote|worldwide/i.test(location) || inferWorkArrangement(desc) === 'REMOTE'
          ? 'REMOTE'
          : inferWorkArrangement(desc),
      employmentType: 'FULL_TIME',
      skills: raw.tags,
      sourceUrl: raw.url ?? `https://remoteok.com/remote-jobs/`,
      applyUrl: raw.apply_url ?? raw.url,
      publishedAt: raw.date,
      attribution: 'Remote OK',
      usageRestrictions: [
        'Remote OK jobs are remote-first; confirm the country each listing targets.',
      ],
    };
  }
}

function isJob(d: RemoteOkMeta | RemoteOkRaw): d is RemoteOkRaw {
  return (
    typeof (d as RemoteOkRaw).title === 'string' && typeof (d as RemoteOkRaw).id !== 'undefined'
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
