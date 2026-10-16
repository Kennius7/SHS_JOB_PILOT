import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shs/data';
import { buildRegistry, ProviderRegistry } from '@shs/provider-sdk';

@Injectable()
export class ProvidersService implements OnModuleInit {
  private readonly logger = new Logger(ProvidersService.name);
  private registry: ProviderRegistry;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.registry = buildRegistry(
      {
        adzunaAppId: config.get('PROVIDER_ADZUNA_APP_ID'),
        adzunaAppKey: config.get('PROVIDER_ADZUNA_APP_KEY'),
        adzunaCountry: config.get('PROVIDER_ADZUNA_COUNTRY', 'ng'),
        joobleApiKey: config.get('PROVIDER_JOOBLE_API_KEY'),
        joobleCountry: config.get('PROVIDER_JOOBLE_COUNTRY', 'ng'),
        usajobsApiKey: config.get('PROVIDER_USAJOBS_API_KEY'),
        usajobsEmail: config.get('PROVIDER_USAJOBS_EMAIL'),
        remotiveEnabled: config.get('PROVIDER_REMOTIVE_ENABLED') !== 'false',
        remoteokEnabled: config.get('PROVIDER_REMOTEOK_ENABLED') !== 'false',
        greenhouseBoard: config.get('PROVIDER_GREENHOUSE_BOARD'),
        leverCompany: config.get('PROVIDER_LEVER_COMPANY'),
        ashbyOrg: config.get('PROVIDER_ASHBY_ORG'),
        mockEnabled: config.get('AI_MOCK_MODE') === 'true',
      },
      config.get('NODE_ENV', 'development'),
    );
  }

  async onModuleInit() {
    // Ensure every provider in the registry has a JobProvider row.
    for (const p of this.registry.list()) {
      await this.prisma.jobProvider.upsert({
        where: { key: p.key },
        create: {
          key: p.key,
          displayName: p.displayName,
          accessMode: p.capabilities.accessMode,
          capabilities: p.capabilities as any,
          enabled: true,
          configured: p.capabilities.requiresCredentials ? true : true,
        },
        update: {
          displayName: p.displayName,
          accessMode: p.capabilities.accessMode,
          capabilities: p.capabilities as any,
        },
      });
    }
    for (const m of this.registry.listManual()) {
      await this.prisma.jobProvider.upsert({
        where: { key: m.key },
        create: {
          key: m.key,
          displayName: m.displayName,
          accessMode: m.capabilities.accessMode,
          capabilities: m.capabilities as any,
          enabled: true,
          configured: true,
        },
        update: {
          displayName: m.displayName,
          accessMode: m.capabilities.accessMode,
          capabilities: m.capabilities as any,
        },
      });
    }
    this.logger.log(
      `Registered ${this.registry.list().length} active + ${this.registry.listManual().length} manual providers`,
    );
  }

  get(key: string) {
    return this.registry.get(key);
  }
  registry_() {
    return this.registry;
  }
}
