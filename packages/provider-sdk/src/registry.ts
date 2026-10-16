import { JobProvider } from './types';
import { AdzunaAdapter } from './adapters/adzuna.adapter';
import { JoobleAdapter } from './adapters/jooble.adapter';
import { RemotiveAdapter } from './adapters/remotive.adapter';
import { RemoteOkAdapter } from './adapters/remoteok.adapter';
import { UsaJobsAdapter } from './adapters/usajobs.adapter';
import { GreenhouseAdapter } from './adapters/greenhouse.adapter';
import { LeverAdapter } from './adapters/lever.adapter';
import { AshbyAdapter } from './adapters/ashby.adapter';
import { MockSubmissionProvider } from './adapters/mock.adapter';

export interface InitialProviderEntry {
  key: string;
  displayName: string;
  capabilities: JobProvider['capabilities'];
}

/**
 * Providers registered as manual-link only. They carry no search/submission
 * logic. The application flow treats them as sources of canonical apply URLs.
 *
 * LinkedIn, Indeed, and Jobberman all prohibit automated scraping and
 * application submission under their current terms. SHS Job Pilot tracks
 * applications for these providers but routes submission through the user.
 */
export const MANUAL_LINK_PROVIDERS: InitialProviderEntry[] = [
  {
    key: 'linkedin',
    displayName: 'LinkedIn Jobs',
    capabilities: {
      searchJobs: false,
      retrieveJobDetails: false,
      submitApplications: false,
      verifySubmission: false,
      supportsPagination: false,
      requiresCredentials: false,
      requiresEmployerAuthorization: true,
      accessMode: 'MANUAL_LINK_ONLY',
    },
  },
  {
    key: 'indeed',
    displayName: 'Indeed',
    capabilities: {
      searchJobs: false,
      retrieveJobDetails: false,
      submitApplications: false,
      verifySubmission: false,
      supportsPagination: false,
      requiresCredentials: false,
      requiresEmployerAuthorization: true,
      accessMode: 'MANUAL_LINK_ONLY',
    },
  },
  {
    key: 'jobberman',
    displayName: 'Jobberman Nigeria',
    capabilities: {
      searchJobs: false,
      retrieveJobDetails: false,
      submitApplications: false,
      verifySubmission: false,
      supportsPagination: false,
      requiresCredentials: false,
      requiresEmployerAuthorization: true,
      accessMode: 'MANUAL_LINK_ONLY',
    },
  },
];

export class ProviderRegistry {
  private providers = new Map<string, JobProvider>();
  private manualEntries = new Map<string, InitialProviderEntry>();

  register(provider: JobProvider): void {
    if (this.providers.has(provider.key)) {
      throw new Error(`Provider ${provider.key} already registered`);
    }
    this.providers.set(provider.key, provider);
  }

  registerManual(entry: InitialProviderEntry): void {
    if (this.manualEntries.has(entry.key)) {
      throw new Error(`Manual provider ${entry.key} already registered`);
    }
    this.manualEntries.set(entry.key, entry);
  }

  get(key: string): JobProvider | undefined {
    return this.providers.get(key);
  }

  getManual(key: string): InitialProviderEntry | undefined {
    return this.manualEntries.get(key);
  }

  list(): JobProvider[] {
    return [...this.providers.values()];
  }

  listManual(): InitialProviderEntry[] {
    return [...this.manualEntries.values()];
  }

  has(key: string): boolean {
    return this.providers.has(key) || this.manualEntries.has(key);
  }
}

export interface RegistryEnv {
  adzunaAppId?: string;
  adzunaAppKey?: string;
  adzunaCountry?: string;
  joobleApiKey?: string;
  joobleCountry?: string;
  usajobsApiKey?: string;
  usajobsEmail?: string;
  remotiveEnabled?: boolean;
  remoteokEnabled?: boolean;
  greenhouseBoard?: string;
  leverCompany?: string;
  ashbyOrg?: string;
  mockEnabled?: boolean;
}

/**
 * Build the registry from environment. Manual-link providers are always
 * registered. Providers whose operating mode requires credentials are only
 * registered when those credentials are present. Public APIs without
 * credentials are registered unless explicitly disabled.
 */
export function buildRegistry(env: RegistryEnv, nodeEnv = 'development'): ProviderRegistry {
  const registry = new ProviderRegistry();

  for (const entry of MANUAL_LINK_PROVIDERS) {
    registry.registerManual(entry);
  }

  if (env.adzunaAppId && env.adzunaAppKey) {
    registry.register(
      new AdzunaAdapter(env.adzunaAppId, env.adzunaAppKey, env.adzunaCountry ?? 'ng'),
    );
  }

  if (env.joobleApiKey) {
    registry.register(new JoobleAdapter(env.joobleApiKey, env.joobleCountry ?? 'ng'));
  }

  if (env.usajobsApiKey && env.usajobsEmail) {
    registry.register(new UsaJobsAdapter(env.usajobsApiKey, env.usajobsEmail));
  }

  if (env.remotiveEnabled !== false) {
    registry.register(new RemotiveAdapter());
  }

  if (env.remoteokEnabled !== false) {
    registry.register(new RemoteOkAdapter());
  }

  if (env.greenhouseBoard) {
    registry.register(new GreenhouseAdapter(env.greenhouseBoard));
  }

  if (env.leverCompany) {
    registry.register(new LeverAdapter(env.leverCompany));
  }

  if (env.ashbyOrg) {
    registry.register(new AshbyAdapter(env.ashbyOrg));
  }

  if (env.mockEnabled || nodeEnv !== 'production') {
    registry.register(new MockSubmissionProvider());
  }

  return registry;
}
