import {
  JobProvider,
  ProviderCapabilities,
  ProviderSearchQuery,
  ProviderSearchResult,
  NormalizedJob,
  ProviderRateLimitError,
} from '../types';
import { inferWorkArrangement, mapEmploymentType } from './mapping';

interface LeverCategories {
  team?: string;
  commitment?: string;
  location?: string;
  allLocations?: string[];
}

interface LeverRaw {
  id?: string;
  text?: string;
  categories?: LeverCategories;
  workplaceType?: string;
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{ text?: string }>;
  additionalPlain?: string;
  applyUrl?: string;
  hostedUrl?: string;
  createdAt?: number;
  salaryRange?: { min?: number; max?: number; currency?: string };
}

/** Lever postings API has no pagination; it returns the full board. */
export class LeverAdapter implements JobProvider {
  readonly key = 'lever';
  readonly displayName = 'Lever (boards)';
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

  private readonly baseUrl = 'https://api.lever.co/v0/postings';

  constructor(private company: string) {}

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/${this.company}?mode=json&limit=1`);
      if (res.status === 404) return { available: false, reason: 'Company board not found' };
      if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
      return { available: true };
    } catch (e) {
      return { available: false, reason: (e as Error).message };
    }
  }

  async searchJobs(q: ProviderSearchQuery): Promise<ProviderSearchResult> {
    const res = await fetch(`${this.baseUrl}/${this.company}?mode=json`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 429) throw new ProviderRateLimitError(this.key);
    if (!res.ok) throw new Error(`LEVER_HTTP_${res.status}`);

    const data = (await res.json()) as LeverRaw[] | { data?: LeverRaw[] };
    const items = Array.isArray(data) ? data : (data.data ?? []);

    const locationFilter = q.location?.toLowerCase();
    const jobs = locationFilter
      ? items.filter((raw) =>
          (raw.categories?.allLocations ?? [])
            .concat(raw.categories?.location ?? '')
            .join(' ')
            .toLowerCase()
            .includes(locationFilter),
        )
      : items;

    return { jobs: jobs.map((r) => this.normalize(r)), totalEstimate: jobs.length };
  }

  private normalize(raw: LeverRaw): NormalizedJob {
    const categories = raw.categories ?? {};
    const allLocations = categories.allLocations?.filter(Boolean) ?? [];
    const location = categories.location ?? allLocations[0] ?? '';
    const workplaceType = raw.workplaceType;

    const description = [
      stripHtml(raw.description ?? ''),
      ...(raw.lists?.flatMap((l) => (l.text ? [`- ${l.text}`] : [])) ?? []),
      raw.additionalPlain ?? '',
    ]
      .filter(Boolean)
      .join('\n')
      .trim();

    return {
      providerKey: this.key,
      externalId: String(raw.id ?? ''),
      title: raw.text ?? 'Unknown position',
      employer: this.company,
      description: description || undefined,
      location: this.parseLocation(location),
      workArrangement: workplaceType
        ? inferWorkArrangement(`${workplaceType} ${location}`)
        : inferWorkArrangement(location),
      employmentType: mapEmploymentType(categories.commitment),
      salary: raw.salaryRange
        ? {
            min: raw.salaryRange.min,
            max: raw.salaryRange.max,
            currency: raw.salaryRange.currency,
            period: 'YEAR',
          }
        : undefined,
      sourceUrl: raw.hostedUrl ?? raw.applyUrl ?? `https://jobs.lever.co/${this.company}`,
      applyUrl: raw.applyUrl,
      publishedAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : undefined,
      attribution: `${this.company} via Lever`,
      usageRestrictions: [
        'Lever terms apply; do not automate submission to employers that forbid it.',
      ],
    };
  }

  private parseLocation(name: string): { city?: string; region?: string; country?: string } {
    if (!name) return {};
    if (/remote|anywhere|san francisco|new york|worldwide/i.test(name)) {
      return { country: 'REMOTE', region: name };
    }
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
