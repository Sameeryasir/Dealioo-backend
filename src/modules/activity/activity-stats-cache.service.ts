import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ACTIVITY_STATS_CACHE_TTL_SECONDS } from './activity-stats-queue.constants';

type CachedActivityStatsEnvelope<T> = {
  computedAt: number;
  value: T;
};

@Injectable()
export class ActivityStatsCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ActivityStatsCacheService.name);
  private readonly client: Redis | null;
  private readonly ttlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
    const port = parseInt(
      this.configService.get<string>('REDIS_PORT', '6379'),
      10,
    );
    const ttlRaw = parseInt(
      this.configService.get<string>(
        'ACTIVITY_STATS_CACHE_TTL_SECONDS',
        String(ACTIVITY_STATS_CACHE_TTL_SECONDS),
      ),
      10,
    );
    this.ttlSeconds =
      Number.isFinite(ttlRaw) && ttlRaw > 0
        ? ttlRaw
        : ACTIVITY_STATS_CACHE_TTL_SECONDS;

    try {
      this.client = new Redis({
        host,
        port,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: true,
      });
      void this.client.connect().catch((error) => {
        this.logger.warn(
          `Activity stats Redis unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    } catch (error) {
      this.client = null;
      this.logger.warn(
        `Activity stats Redis not configured: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  async getEnvelope<T>(
    key: string,
  ): Promise<CachedActivityStatsEnvelope<T> | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CachedActivityStatsEnvelope<T>;
    } catch {
      return null;
    }
  }

  async tryAcquireComputeLock(key: string, ttlSeconds = 45): Promise<boolean> {
    if (!this.client) return true;
    try {
      const result = await this.client.set(
        `activity-stats-lock:${key}`,
        '1',
        'EX',
        ttlSeconds,
        'NX',
      );
      return result === 'OK';
    } catch {
      return true;
    }
  }

  async releaseComputeLock(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(`activity-stats-lock:${key}`);
    } catch {
      return;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.client) return;
    const envelope: CachedActivityStatsEnvelope<T> = {
      computedAt: Date.now(),
      value,
    };
    try {
      await this.client.set(
        key,
        JSON.stringify(envelope),
        'EX',
        this.ttlSeconds,
      );
    } catch {
      return;
    }
  }
}
