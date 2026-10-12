import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '@shs/data';

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'api', ts: new Date().toISOString() };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', db: 'ok' };
    } catch (e) {
      return { status: 'not-ready', db: 'down', error: (e as Error).message };
    }
  }
}
