import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';

const CONNECTION_EVENT_TYPES = new Set([
  'oauth_started',
  'stripe_connected',
  'oauth_failed',
  'oauth_aborted',
  'stripe_disconnected',
]);

@Injectable()
export class StripeIntegrationAuditService {
  private readonly logger = new Logger(StripeIntegrationAuditService.name);

  constructor(
    @InjectRepository(IntegrationAuditLog)
    private readonly auditRepository: Repository<IntegrationAuditLog>,
  ) {}

  async log(
    businessId: number,
    eventType: string,
    options?: {
      status?: string | null;
      metadata?: Record<string, unknown>;
      errorMessage?: string;
    },
  ): Promise<void> {
    if (!CONNECTION_EVENT_TYPES.has(eventType)) {
      return;
    }

    const metadata = this.sanitizeMetadata(options?.metadata);

    await this.auditRepository.save({
      businessId,
      provider: 'stripe',
      eventType,
      status: options?.status ?? null,
      metadata,
      errorMessage: options?.errorMessage ?? null,
    });

    this.logger.log(
      `stripe.${eventType} business=${businessId} status=${options?.status ?? 'n/a'}`,
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
