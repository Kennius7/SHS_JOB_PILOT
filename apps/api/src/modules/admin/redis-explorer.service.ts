import { Injectable, OnModuleDestroy, BadRequestException } from '@nestjs/common';
import { Redis } from 'ioredis';

const VALUE_CAP = 200;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? (value as string[]) : [];

/**
 * Read-only Redis browser for the admin console. Uses its own ioredis client
 * pointed at the same `REDIS_URL` the queues use, so the keys shown are the
 * live BullMQ + application keys.
 */
@Injectable()
export class RedisExplorerService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
    });
    // Prevent an unhandled 'error' event from crashing the process when Redis
    // is unreachable; individual requests surface their own errors.
    this.client.on('error', () => undefined);
  }

  async onModuleDestroy() {
    try {
      this.client.disconnect();
    } catch {
      // ignore
    }
  }

  async keys(pattern: string, cursor: string, limit: number) {
    const match = pattern?.trim() ? pattern.trim() : '*';
    const keys: { key: string; type: string; ttl: number }[] = [];
    let next = cursor && cursor !== '' ? cursor : '0';
    let iterations = 0;

    do {
      const [scanCursor, batch] = (await this.client.scan(next, 'MATCH', match, 'COUNT', 200)) as [
        string,
        string[],
      ];
      next = scanCursor;
      for (const key of batch) {
        if (keys.length >= limit) break;
        const [type, ttl] = await Promise.all([this.client.type(key), this.client.ttl(key)]);
        keys.push({ key, type, ttl });
      }
      iterations++;
    } while (next !== '0' && keys.length < limit && iterations < 50);

    return { cursor: next, keys, done: next === '0' };
  }

  async key(key: string) {
    if (!key) throw new BadRequestException('A key is required');
    const type = await this.client.type(key);
    if (type === 'none') {
      return { key, type: 'none', ttl: -2, size: 0, value: null, truncated: false };
    }

    const pttl = await this.client.pttl(key);
    const ttl = pttl < 0 ? pttl : Math.round(pttl / 1000);
    let value: unknown = null;
    let size = 0;
    let truncated = false;

    switch (type) {
      case 'string': {
        const v = await this.client.get(key);
        value = v;
        size = v?.length ?? 0;
        break;
      }
      case 'list': {
        size = await this.client.llen(key);
        value = await this.client.lrange(key, 0, VALUE_CAP - 1);
        truncated = size > VALUE_CAP;
        break;
      }
      case 'set': {
        size = await this.client.scard(key);
        value =
          size > VALUE_CAP
            ? asStringArray(await this.client.srandmember(key, VALUE_CAP))
            : asStringArray(await this.client.smembers(key));
        truncated = size > VALUE_CAP;
        break;
      }
      case 'zset': {
        size = await this.client.zcard(key);
        const flat = asStringArray(await this.client.zrange(key, 0, VALUE_CAP - 1, 'WITHSCORES'));
        value = [];
        for (let i = 0; i < flat.length; i += 2) {
          (value as { member: string; score: string }[]).push({
            member: flat[i],
            score: flat[i + 1],
          });
        }
        truncated = size > VALUE_CAP;
        break;
      }
      case 'hash': {
        size = await this.client.hlen(key);
        value = await this.client.hgetall(key);
        truncated = size > VALUE_CAP;
        break;
      }
      case 'stream': {
        size = await this.client.xlen(key);
        value = await this.client.xrange(key, '-', '+', 'COUNT', VALUE_CAP);
        truncated = size > VALUE_CAP;
        break;
      }
      default:
        break;
    }

    return { key, type, ttl, size, value, truncated };
  }
}
