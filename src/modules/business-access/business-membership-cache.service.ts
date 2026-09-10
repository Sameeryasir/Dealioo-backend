import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { BusinessMemberPermission } from '../member/member.constants';

export type CachedBusinessMembership = {
  access: 'owner' | 'member';
  role: string;
  status: string;
  permissions: BusinessMemberPermission[];
};

@Injectable()
export class BusinessMembershipCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(BusinessMembershipCacheService.name);
  private readonly client: Redis | null;
  private readonly ttlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
    const port = parseInt(
      this.configService.get<string>('REDIS_PORT', '6379'),
      10,
    );
    this.ttlSeconds = parseInt(
      this.configService.get<string>('BUSINESS_MEMBER_CACHE_TTL_SECONDS', '300'),
      10,
    );

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
          `Business membership Redis unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    } catch (error) {
      this.client = null;
      this.logger.warn(
        `Business membership Redis not configured: ${
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

  cacheKey(businessId: number, userId: number): string {
    return `business-member:${businessId}:${userId}`;
  }

  async get(
    businessId: number,
    userId: number,
  ): Promise<CachedBusinessMembership | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(this.cacheKey(businessId, userId));
      if (!raw) return null;
      return JSON.parse(raw) as CachedBusinessMembership;
    } catch {
      return null;
    }
  }

  async set(
    businessId: number,
    userId: number,
    value: CachedBusinessMembership,
  ): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(
        this.cacheKey(businessId, userId),
        JSON.stringify(value),
        'EX',
        Number.isFinite(this.ttlSeconds) && this.ttlSeconds > 0
          ? this.ttlSeconds
          : 300,
      );
    } catch {
      return;
    }
  }

  async invalidate(businessId: number, userId: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(this.cacheKey(businessId, userId));
    } catch {
      return;
    }
  }
}
