import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import {
  BusinessHistory,
  BusinessHistoryEventType,
} from '../../db/entities/business-history.entity';
import type { HistoryCategory } from './dto/get-business-history-query.dto';

export type BusinessHistoryListItem = {
  id: number;
  eventType: BusinessHistoryEventType;
  description: string;
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  occurredAt: string;
};

export type BusinessHistoryListFilters = {
  page?: number;
  category?: HistoryCategory;
  eventType?: string;
  actorUserId?: number;
  q?: string;
  from?: string;
  to?: string;
};

const CATEGORY_EVENT_TYPES: Record<
  Exclude<HistoryCategory, 'all'>,
  BusinessHistoryEventType[]
> = {
  funnels: [
    BusinessHistoryEventType.FUNNEL_UPDATED,
    BusinessHistoryEventType.FUNNEL_DELETED,
  ],
  automations: [
    BusinessHistoryEventType.AUTOMATION_UPDATED,
    BusinessHistoryEventType.AUTOMATION_ACTIVATED,
    BusinessHistoryEventType.AUTOMATION_DEACTIVATED,
    BusinessHistoryEventType.AUTOMATION_DELETED,
  ],
  campaigns: [
    BusinessHistoryEventType.CAMPAIGN_CREATED,
    BusinessHistoryEventType.CAMPAIGN_UPDATED,
    BusinessHistoryEventType.CAMPAIGN_DELETED,
  ],
  payments: [
    BusinessHistoryEventType.SCANNER_REDEEMED,
    BusinessHistoryEventType.SCANNER_PAYMENT,
    BusinessHistoryEventType.SCANNER_PURCHASE,
  ],
};

type LogCampaignParams = {
  businessId: number;
  campaignId: number;
  campaignName: string;
  actorUserId?: number | null;
};

type LogBusinessParams = {
  businessId: number;
  businessName: string;
  actorUserId?: number | null;
};

type LogAutomationParams = {
  businessId: number;
  automationId: number;
  automationName: string;
  actorUserId?: number | null;
};

type LogFunnelParams = {
  businessId: number;
  funnelId: number;
  funnelName: string;
  actorUserId?: number | null;
};

type LogScannerRedeemParams = {
  businessId: number;
  customerName: string;
  campaignName: string;
  couponIds: number[];
  actorUserId?: number | null;
  occurredAt?: Date;
};

type LogScannerPaymentParams = {
  businessId: number;
  customerName: string;
  campaignName: string;
  amountLabel: string;
  couponIds: number[];
  actorUserId?: number | null;
  occurredAt?: Date;
};

type LogScannerPurchaseParams = {
  businessId: number;
  customerName: string;
  dealNames: string;
  amountLabel: string;
  couponIds: number[];
  actorUserId?: number | null;
  idempotencyKey?: string | null;
  occurredAt?: Date;
};

const HISTORY_PAGE_SIZE = 10;

@Injectable()
export class BusinessHistoryService {
  constructor(
    @InjectRepository(BusinessHistory)
    private readonly historyRepository: Repository<BusinessHistory>,
  ) {}

  async getBusinessHistory(
    businessId: number,
    filters: BusinessHistoryListFilters = {},
  ): Promise<{
    data: BusinessHistoryListItem[];
    meta: PaginationMeta;
    counts: Record<HistoryCategory, number>;
    actors: Array<{ id: number; name: string }>;
  }> {
    const pagination = normalizePagination(filters.page, HISTORY_PAGE_SIZE);
    const qb = this.historyRepository
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.actorUser', 'actorUser')
      .leftJoinAndSelect('actorUser.role', 'actorRole')
      .where('history.businessId = :businessId', { businessId });

    const categoryTypes = categoryEventTypes(filters.category);
    if (categoryTypes) {
      qb.andWhere('history.eventType IN (:...categoryTypes)', { categoryTypes });
    }

    if (
      filters.eventType &&
      Object.values(BusinessHistoryEventType).includes(
        filters.eventType as BusinessHistoryEventType,
      )
    ) {
      qb.andWhere('history.eventType = :eventType', {
        eventType: filters.eventType,
      });
    }

    if (
      typeof filters.actorUserId === 'number' &&
      Number.isFinite(filters.actorUserId) &&
      filters.actorUserId > 0
    ) {
      qb.andWhere('history.actorUserId = :actorUserId', {
        actorUserId: filters.actorUserId,
      });
    }

    const search = filters.q?.trim();
    if (search) {
      qb.andWhere(
        '(history.description ILIKE :search OR history.eventType ILIKE :search OR actorUser.name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const fromDate = parseDayEdge(filters.from, 'start');
    const toDate = parseDayEdge(filters.to, 'end');
    if (fromDate) {
      qb.andWhere('history.occurredAt >= :fromDate', { fromDate });
    }
    if (toDate) {
      qb.andWhere('history.occurredAt <= :toDate', { toDate });
    }

    const [rows, total] = await qb
      .orderBy('history.occurredAt', 'DESC')
      .addOrderBy('history.id', 'DESC')
      .skip(pagination.skip)
      .take(pagination.limit)
      .getManyAndCount();

    const [counts, actors] = await Promise.all([
      this.categoryCounts(businessId),
      this.distinctActors(businessId),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        description: row.description,
        actorUserId: row.actorUserId,
        actorName: row.actorUser?.name?.trim() || null,
        actorRole: row.actorUser?.role?.name?.trim() || null,
        occurredAt: row.occurredAt.toISOString(),
      })),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
      counts,
      actors,
    };
  }

  private async categoryCounts(
    businessId: number,
  ): Promise<Record<HistoryCategory, number>> {
    const rows = await this.historyRepository
      .createQueryBuilder('history')
      .select('history.eventType', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .where('history.businessId = :businessId', { businessId })
      .groupBy('history.eventType')
      .getRawMany<{ eventType: BusinessHistoryEventType; count: string }>();

    const byType = new Map(
      rows.map((row) => [row.eventType, Number(row.count) || 0]),
    );
    const sum = (types: BusinessHistoryEventType[]) =>
      types.reduce((total, type) => total + (byType.get(type) ?? 0), 0);

    return {
      all: rows.reduce((total, row) => total + (Number(row.count) || 0), 0),
      funnels: sum(CATEGORY_EVENT_TYPES.funnels),
      automations: sum(CATEGORY_EVENT_TYPES.automations),
      campaigns: sum(CATEGORY_EVENT_TYPES.campaigns),
      payments: sum(CATEGORY_EVENT_TYPES.payments),
    };
  }

  private async distinctActors(
    businessId: number,
  ): Promise<Array<{ id: number; name: string }>> {
    const rows = await this.historyRepository
      .createQueryBuilder('history')
      .innerJoin('history.actorUser', 'actorUser')
      .select('actorUser.id', 'id')
      .addSelect('actorUser.name', 'name')
      .where('history.businessId = :businessId', { businessId })
      .andWhere('history.actorUserId IS NOT NULL')
      .groupBy('actorUser.id')
      .addGroupBy('actorUser.name')
      .orderBy('actorUser.name', 'ASC')
      .getRawMany<{ id: number; name: string }>();

    return rows
      .map((row) => ({
        id: Number(row.id),
        name: row.name?.trim() || 'User',
      }))
      .filter((row) => Number.isFinite(row.id) && row.id > 0);
  }

  async logCampaignCreated(params: LogCampaignParams): Promise<void> {
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.CAMPAIGN_CREATED,
      description: `Created campaign "${this.campaignLabel(params)}"`,
      actorUserId: params.actorUserId,
      idempotencyKey: `campaign_created:${params.campaignId}`,
    });
  }

  async logCampaignUpdated(params: LogCampaignParams): Promise<void> {
    const occurredAt = new Date();
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.CAMPAIGN_UPDATED,
      description: `Updated campaign "${this.campaignLabel(params)}"`,
      actorUserId: params.actorUserId,
      occurredAt,
      idempotencyKey: `campaign_updated:${params.campaignId}:${occurredAt.getTime()}`,
    });
  }

  async logCampaignDeleted(params: LogCampaignParams): Promise<void> {
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.CAMPAIGN_DELETED,
      description: `Deleted campaign "${this.campaignLabel(params)}"`,
      actorUserId: params.actorUserId,
      idempotencyKey: `campaign_deleted:${params.campaignId}`,
    });
  }

  async logBusinessCreated(params: LogBusinessParams): Promise<void> {
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.BUSINESS_CREATED,
      description: `Created business "${this.businessLabel(params)}"`,
      actorUserId: params.actorUserId,
      idempotencyKey: `business_created:${params.businessId}`,
    });
  }

  async logBusinessUpdated(params: LogBusinessParams): Promise<void> {
    const occurredAt = new Date();
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.BUSINESS_UPDATED,
      description: `Updated business "${this.businessLabel(params)}"`,
      actorUserId: params.actorUserId,
      occurredAt,
      idempotencyKey: `business_updated:${params.businessId}:${occurredAt.getTime()}`,
    });
  }

  async logBusinessDeleted(params: LogBusinessParams): Promise<void> {
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.BUSINESS_DELETED,
      description: `Deleted business "${this.businessLabel(params)}"`,
      actorUserId: params.actorUserId,
      idempotencyKey: `business_deleted:${params.businessId}`,
    });
  }

  async logAutomationUpdated(params: LogAutomationParams): Promise<void> {
    const occurredAt = new Date();
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.AUTOMATION_UPDATED,
      description: `Updated automation "${this.automationLabel(params)}"`,
      actorUserId: params.actorUserId,
      occurredAt,
      idempotencyKey: `automation_updated:${params.automationId}:${occurredAt.getTime()}`,
    });
  }

  async logAutomationActivated(params: LogAutomationParams): Promise<void> {
    const occurredAt = new Date();
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.AUTOMATION_ACTIVATED,
      description: `Activated automation "${this.automationLabel(params)}"`,
      actorUserId: params.actorUserId,
      occurredAt,
      idempotencyKey: `automation_activated:${params.automationId}:${occurredAt.getTime()}`,
    });
  }

  async logAutomationDeactivated(params: LogAutomationParams): Promise<void> {
    const occurredAt = new Date();
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.AUTOMATION_DEACTIVATED,
      description: `Deactivated automation "${this.automationLabel(params)}"`,
      actorUserId: params.actorUserId,
      occurredAt,
      idempotencyKey: `automation_deactivated:${params.automationId}:${occurredAt.getTime()}`,
    });
  }

  async logAutomationDeleted(params: LogAutomationParams): Promise<void> {
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.AUTOMATION_DELETED,
      description: `Deleted automation "${this.automationLabel(params)}"`,
      actorUserId: params.actorUserId,
      idempotencyKey: `automation_deleted:${params.automationId}`,
    });
  }

  async logFunnelUpdated(params: LogFunnelParams): Promise<void> {
    const occurredAt = new Date();
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.FUNNEL_UPDATED,
      description: `Updated funnel "${this.funnelLabel(params)}"`,
      actorUserId: params.actorUserId,
      occurredAt,
      idempotencyKey: `funnel_updated:${params.funnelId}:${occurredAt.getTime()}`,
    });
  }

  async logFunnelDeleted(params: LogFunnelParams): Promise<void> {
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.FUNNEL_DELETED,
      description: `Deleted funnel "${this.funnelLabel(params)}"`,
      actorUserId: params.actorUserId,
      idempotencyKey: `funnel_deleted:${params.funnelId}`,
    });
  }

  async logScannerRedeemed(params: LogScannerRedeemParams): Promise<void> {
    const couponKey = this.couponIdsKey(params.couponIds);
    const guest = params.customerName.trim() || 'Guest';
    const deal = params.campaignName.trim() || 'deal';
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.SCANNER_REDEEMED,
      description: `Scanner redeemed "${deal}" for ${guest}`,
      actorUserId: params.actorUserId,
      occurredAt: params.occurredAt,
      idempotencyKey: `scanner_redeemed:${params.businessId}:${couponKey}`,
    });
  }

  async logScannerPayment(params: LogScannerPaymentParams): Promise<void> {
    const couponKey = this.couponIdsKey(params.couponIds);
    const guest = params.customerName.trim() || 'Guest';
    const deal = params.campaignName.trim() || 'deal';
    const amount = params.amountLabel.trim() || 'payment';
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.SCANNER_PAYMENT,
      description: `Scanner collected ${amount} for "${deal}" (${guest})`,
      actorUserId: params.actorUserId,
      occurredAt: params.occurredAt,
      idempotencyKey: `scanner_payment:${params.businessId}:${couponKey}`,
    });
  }

  async logScannerPurchase(params: LogScannerPurchaseParams): Promise<void> {
    const guest = params.customerName.trim() || 'Guest';
    const deals = params.dealNames.trim() || 'deal';
    const amount = params.amountLabel.trim() || 'payment';
    const couponKey = this.couponIdsKey(params.couponIds);
    const key =
      params.idempotencyKey?.trim() ||
      `scanner_purchase:${params.businessId}:${couponKey}`;
    await this.insert({
      businessId: params.businessId,
      eventType: BusinessHistoryEventType.SCANNER_PURCHASE,
      description: `Scanner sold "${deals}" to ${guest} for ${amount}`,
      actorUserId: params.actorUserId,
      occurredAt: params.occurredAt,
      idempotencyKey: key.startsWith('scanner_purchase:')
        ? key
        : `scanner_purchase:${params.businessId}:${key}`,
    });
  }

  private couponIdsKey(couponIds: number[]): string {
    const ids = [...new Set(couponIds.filter((id) => Number.isFinite(id) && id > 0))]
      .sort((a, b) => a - b);
    return ids.length > 0 ? ids.join(',') : 'none';
  }

  private campaignLabel(
    params: Pick<LogCampaignParams, 'campaignId' | 'campaignName'>,
  ): string {
    return params.campaignName.trim() || `Campaign #${params.campaignId}`;
  }

  private businessLabel(
    params: Pick<LogBusinessParams, 'businessId' | 'businessName'>,
  ): string {
    return params.businessName.trim() || `Business #${params.businessId}`;
  }

  private automationLabel(
    params: Pick<LogAutomationParams, 'automationId' | 'automationName'>,
  ): string {
    return params.automationName.trim() || `Automation #${params.automationId}`;
  }

  private funnelLabel(
    params: Pick<LogFunnelParams, 'funnelId' | 'funnelName'>,
  ): string {
    return params.funnelName.trim() || `Funnel #${params.funnelId}`;
  }

  private async insert(params: {
    businessId: number | null;
    eventType: BusinessHistoryEventType;
    description: string;
    actorUserId?: number | null;
    idempotencyKey: string;
    occurredAt?: Date;
  }): Promise<void> {
    const exists = await this.historyRepository.exist({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (exists) return;

    await this.historyRepository.save(
      this.historyRepository.create({
        businessId: params.businessId,
        eventType: params.eventType,
        description: params.description,
        actorUserId: params.actorUserId ?? null,
        occurredAt: params.occurredAt ?? new Date(),
        idempotencyKey: params.idempotencyKey,
      }),
    );
  }
}

function categoryEventTypes(
  category?: HistoryCategory,
): BusinessHistoryEventType[] | null {
  if (!category || category === 'all') return null;
  return CATEGORY_EVENT_TYPES[category] ?? null;
}

function parseDayEdge(
  value: string | undefined,
  edge: 'start' | 'end',
): Date | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const [year, month, day] = trimmed.split('-').map(Number);
  if (edge === 'start') {
    return new Date(year, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
  }
  return new Date(year, (month ?? 1) - 1, day ?? 1, 23, 59, 59, 999);
}
