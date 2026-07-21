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

export type BusinessHistoryListItem = {
  id: number;
  eventType: BusinessHistoryEventType;
  description: string;
  actorUserId: number | null;
  actorName: string | null;
  occurredAt: string;
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

const HISTORY_PAGE_SIZE = 10;

@Injectable()
export class BusinessHistoryService {
  constructor(
    @InjectRepository(BusinessHistory)
    private readonly historyRepository: Repository<BusinessHistory>,
  ) {}

  async getBusinessHistory(
    businessId: number,
    page?: number,
  ): Promise<{ data: BusinessHistoryListItem[]; meta: PaginationMeta }> {
    const pagination = normalizePagination(page, HISTORY_PAGE_SIZE);

    const [rows, total] = await this.historyRepository.findAndCount({
      where: { businessId },
      relations: ['actorUser'],
      order: { occurredAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      data: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        description: row.description,
        actorUserId: row.actorUserId,
        actorName: row.actorUser?.name?.trim() || null,
        occurredAt: row.occurredAt.toISOString(),
      })),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
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
