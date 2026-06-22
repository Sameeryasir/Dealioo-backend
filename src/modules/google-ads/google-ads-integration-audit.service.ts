import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import type { GoogleAdsConnectionStatusValue } from './google-ads-connection-status';

@Injectable()
export class GoogleAdsIntegrationAuditService {
  private readonly logger = new Logger(GoogleAdsIntegrationAuditService.name);

  constructor(
    @InjectRepository(IntegrationAuditLog)
    private readonly auditRepository: Repository<IntegrationAuditLog>,
  ) {}

  async log(
    restaurantId: number,
    eventType: string,
    options?: {
      status?: GoogleAdsConnectionStatusValue | null;
      metadata?: Record<string, unknown>;
      errorMessage?: string;
    },
  ): Promise<void> {
    const metadata = this.sanitizeMetadata(options?.metadata);

    await this.auditRepository.save({
      restaurantId,
      provider: 'google_ads',
      eventType,
      status: options?.status ?? null,
      metadata,
      errorMessage: options?.errorMessage ?? null,
    });

    this.logger.log(
      `google_ads.${eventType} restaurant=${restaurantId} status=${options?.status ?? 'n/a'}`,
    );
  }

  private sanitizeMetadata(
    metadata?: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (!metadata) {
      return null;
    }

    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('password')
      ) {
        continue;
      }
      safe[key] = value;
    }
    return safe;
  }
}
