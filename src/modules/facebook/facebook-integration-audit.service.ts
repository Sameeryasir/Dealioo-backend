import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import type { FacebookConnectionStatusValue } from './facebook-connection-status';

@Injectable()
export class FacebookIntegrationAuditService {
  private readonly logger = new Logger(FacebookIntegrationAuditService.name);

  constructor(
    @InjectRepository(IntegrationAuditLog)
    private readonly auditRepository: Repository<IntegrationAuditLog>,
  ) {}

  async log(
    businessId: number,
    eventType: string,
    options?: {
      status?: FacebookConnectionStatusValue | null;
      metadata?: Record<string, unknown>;
      errorMessage?: string;
    },
  ): Promise<void> {
    const metadata = this.sanitizeMetadata(options?.metadata);

    await this.auditRepository.save({
      businessId,
      provider: 'facebook',
      eventType,
      status: options?.status ?? null,
      metadata,
      errorMessage: options?.errorMessage ?? null,
    });

    this.logger.log(
      `facebook.${eventType} business=${businessId} status=${options?.status ?? 'n/a'}`,
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
