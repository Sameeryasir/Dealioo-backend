import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';

const CONNECTION_EVENT_TYPES = [
  'oauth_started',
  'oauth_aborted',
  'oauth_failed',
  'stripe_connected',
  'meta_connected',
  'google_ads_connected',
  'stripe_disconnected',
  'meta_disconnected',
  'google_ads_disconnected',
];

const ALLOWED_PROVIDERS = new Set(['stripe', 'facebook', 'google_ads']);

export type IntegrationAuditLogListItem = {
  id: string;
  provider: string;
  eventType: string;
  status: string | null;
  errorMessage: string | null;
  metadata: Record<string, string>;
  createdAt: string;
};

export type IntegrationAuditListFilters = {
  page?: number;
  provider?: string;
  eventType?: string;
  from?: string;
  to?: string;
  tzOffset?: number;
};

@Injectable()
export class IntegrationAuditService {
  constructor(
    @InjectRepository(IntegrationAuditLog)
    private readonly auditRepository: Repository<IntegrationAuditLog>,
  ) {}

  async listForBusiness(
    businessId: number,
    filters: IntegrationAuditListFilters = {},
  ): Promise<{ data: IntegrationAuditLogListItem[]; meta: PaginationMeta }> {
    const { page: safePage, limit, skip } = normalizePagination(
      filters.page,
      10,
    );

    const eventTypes =
      filters.eventType && CONNECTION_EVENT_TYPES.includes(filters.eventType)
        ? [filters.eventType]
        : CONNECTION_EVENT_TYPES;

    const fromDate = parseFilterInstant(
      filters.from,
      'start',
      filters.tzOffset,
    );
    const toDate = parseFilterInstant(filters.to, 'end', filters.tzOffset);
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException(
        'The start date cannot be after the end date.',
      );
    }

    const qb = this.auditRepository
      .createQueryBuilder('log')
      .where('log.businessId = :businessId', { businessId })
      .andWhere('log.eventType IN (:...eventTypes)', { eventTypes });

    if (filters.provider && ALLOWED_PROVIDERS.has(filters.provider)) {
      qb.andWhere('log.provider = :provider', { provider: filters.provider });
    }

    if (fromDate) {
      qb.andWhere('log.createdAt >= CAST(:fromDate AS timestamptz)', {
        fromDate: fromDate.toISOString(),
      });
    }
    if (toDate) {
      qb.andWhere('log.createdAt <= CAST(:toDate AS timestamptz)', {
        toDate: toDate.toISOString(),
      });
    }

    const [rows, total] = await qb
      .orderBy('log.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        eventType: row.eventType,
        status: row.status,
        errorMessage: row.errorMessage,
        metadata: sanitizePublicMetadata(
          row.metadata,
          row.provider,
          row.eventType,
        ),
        createdAt: row.createdAt.toISOString(),
      })),
      meta: buildPaginationMeta(total, safePage, limit),
    };
  }
}

function parseFilterInstant(
  value: string | undefined,
  edge: 'start' | 'end',
  tzOffsetMinutes?: number,
): Date | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) &&
    typeof tzOffsetMinutes === 'number' &&
    Number.isFinite(tzOffsetMinutes)
  ) {
    const [year, month, day] = trimmed.split('-').map(Number);
    const localMidnightUtcMs =
      Date.UTC(year, (month ?? 1) - 1, day ?? 1) + tzOffsetMinutes * 60 * 1000;
    if (edge === 'start') {
      return new Date(localMidnightUtcMs);
    }
    return new Date(localMidnightUtcMs + 24 * 60 * 60 * 1000 - 1);
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
}

function sanitizePublicMetadata(
  metadata: Record<string, unknown> | null,
  provider: string,
  eventType: string,
): Record<string, string> {
  const publicMeta: Record<string, string> = {};
  const connectedAccount = pickSafeLabel(metadata?.connectedAccount);
  if (connectedAccount) {
    publicMeta.connectedAccount = connectedAccount;
  } else if (eventType.endsWith('_connected')) {
    publicMeta.connectedAccount = defaultConnectedAccountLabel(provider);
  }

  const managerAccount = pickSafeLabel(metadata?.managerAccount);
  if (managerAccount) {
    publicMeta.managerAccount = managerAccount;
  }

  return publicMeta;
}

function pickSafeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  // Drop values that look like account ids (acct_, act_, 10-digit Google ids).
  if (/^(acct_|act_)/i.test(text)) return null;
  if (/^\d{8,12}$/.test(text.replace(/\D/g, '')) && text.replace(/\D/g, '').length >= 8) {
    if (/^[\d-]+$/.test(text)) return null;
  }
  return text;
}

function defaultConnectedAccountLabel(provider: string): string {
  if (provider === 'stripe') return 'Stripe account';
  if (provider === 'facebook') return 'Meta ad account';
  if (provider === 'google_ads') return 'Google Ads account';
  return 'Connected account';
}
