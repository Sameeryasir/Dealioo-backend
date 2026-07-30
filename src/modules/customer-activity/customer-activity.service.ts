import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  CustomerActivity,
  CustomerActivityReferenceType,
  CustomerActivitySource,
  CustomerActivityType,
} from '../../db/entities/customer-activity.entity';

export type RecordCustomerActivityInput = {
  businessId: number;
  customerId: number;
  activityType: CustomerActivityType;
  source: CustomerActivitySource;
  referenceType?: CustomerActivityReferenceType | null;
  referenceId?: string | number | null;
  amount?: number | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey: string;
  manager?: EntityManager;
  occurredAt?: Date;
};

export type CustomerActivityTimelineItem = {
  id: string;
  activityType: CustomerActivityType;
  source: CustomerActivitySource;
  referenceType: CustomerActivityReferenceType | null;
  referenceId: string | null;
  amount: number | null;
  currency: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  label: string;
};

@Injectable()
export class CustomerActivityService {
  private readonly logger = new Logger(CustomerActivityService.name);

  constructor(
    @InjectRepository(CustomerActivity)
    private readonly customerActivityRepository: Repository<CustomerActivity>,
  ) {}

  async record(input: RecordCustomerActivityInput): Promise<CustomerActivity | null> {
    const repo = input.manager
      ? input.manager.getRepository(CustomerActivity)
      : this.customerActivityRepository;

    const existing = await repo.findOne({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return existing;
    }

    try {
      const row = repo.create({
        businessId: input.businessId,
        customerId: input.customerId,
        activityType: input.activityType,
        source: input.source,
        referenceType: input.referenceType ?? null,
        referenceId:
          input.referenceId == null ? null : String(input.referenceId),
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        metadata: input.metadata ?? null,
        idempotencyKey: input.idempotencyKey,
        ...(input.occurredAt
          ? { createdAt: input.occurredAt, updatedAt: input.occurredAt }
          : {}),
      });
      return await repo.save(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/duplicate|unique/i.test(message)) {
        return (
          (await repo.findOne({
            where: { idempotencyKey: input.idempotencyKey },
          })) ?? null
        );
      }
      this.logger.warn(
        `customer_activity write failed (${input.activityType}): ${message}`,
      );
      throw error;
    }
  }

  async recordOnlineSignup(params: {
    businessId: number;
    customerId: number;
    funnelId: number;
    campaignId: number;
    funnelEventId?: number | null;
    occurredAt?: Date;
    manager?: EntityManager;
  }): Promise<void> {
    await this.record({
      businessId: params.businessId,
      customerId: params.customerId,
      activityType: CustomerActivityType.ONLINE_SIGNUP,
      source: CustomerActivitySource.ONLINE,
      referenceType: null,
      referenceId: null,
      amount: null,
      currency: null,
      idempotencyKey: `activity:signup:funnel:${params.funnelId}:customer:${params.customerId}`,
      metadata: {
        funnelId: params.funnelId,
        campaignId: params.campaignId,
        funnelEventId: params.funnelEventId ?? null,
        label: 'Signed up for deal',
      },
      occurredAt: params.occurredAt,
      manager: params.manager,
    });
  }

  async recordOnlinePurchase(params: {
    businessId: number;
    customerId: number;
    orderId: number;
    amountCents: number;
    currency: string;
    funnelPaymentId?: number | null;
    funnelId?: number | null;
    campaignId?: number | null;
    occurredAt?: Date;
    manager?: EntityManager;
  }): Promise<void> {
    await this.record({
      businessId: params.businessId,
      customerId: params.customerId,
      activityType: CustomerActivityType.ONLINE_PURCHASE,
      source: CustomerActivitySource.ONLINE,
      referenceType: CustomerActivityReferenceType.ORDER,
      referenceId: params.orderId,
      amount: params.amountCents,
      currency: params.currency || 'usd',
      idempotencyKey: `activity:online_purchase:order:${params.orderId}`,
      metadata: {
        funnelPaymentId: params.funnelPaymentId ?? null,
        funnelId: params.funnelId ?? null,
        campaignId: params.campaignId ?? null,
        campaignIds:
          params.campaignId != null ? [params.campaignId] : [],
        label: 'Purchased online',
      },
      occurredAt: params.occurredAt,
      manager: params.manager,
    });
  }

  async recordInStorePurchase(params: {
    businessId: number;
    customerId: number;
    orderId: number;
    amountCents: number;
    currency: string;
    funnelPaymentIds?: number[];
    funnelIds?: number[];
    campaignIds?: number[];
    staffUserId?: number | null;
    occurredAt?: Date;
    manager?: EntityManager;
  }): Promise<void> {
    await this.record({
      businessId: params.businessId,
      customerId: params.customerId,
      activityType: CustomerActivityType.IN_STORE_PURCHASE,
      source: CustomerActivitySource.SCANNER,
      referenceType: CustomerActivityReferenceType.ORDER,
      referenceId: params.orderId,
      amount: params.amountCents,
      currency: params.currency || 'usd',
      idempotencyKey: `activity:in_store_purchase:order:${params.orderId}`,
      metadata: {
        funnelPaymentIds: params.funnelPaymentIds ?? [],
        funnelIds: params.funnelIds ?? [],
        campaignIds: params.campaignIds ?? [],
        campaignId: params.campaignIds?.[0] ?? null,
        staffUserId: params.staffUserId ?? null,
        label: 'Purchased in store',
      },
      occurredAt: params.occurredAt,
      manager: params.manager,
    });
  }

  async recordRedemption(params: {
    businessId: number;
    customerId: number;
    couponId: number;
    campaignId: number;
    funnelId?: number | null;
    funnelPaymentId?: number | null;
    amountCents?: number | null;
    currency?: string | null;
    occurredAt?: Date;
    manager?: EntityManager;
  }): Promise<void> {
    await this.record({
      businessId: params.businessId,
      customerId: params.customerId,
      activityType: CustomerActivityType.REDEMPTION,
      source: CustomerActivitySource.SCANNER,
      referenceType: CustomerActivityReferenceType.COUPON,
      referenceId: params.couponId,
      amount: params.amountCents ?? null,
      currency: params.currency ?? null,
      idempotencyKey: `activity:redemption:coupon:${params.couponId}`,
      metadata: {
        couponId: params.couponId,
        campaignId: params.campaignId,
        campaignIds: [params.campaignId],
        funnelId: params.funnelId ?? null,
        funnelPaymentId: params.funnelPaymentId ?? null,
        label: 'Redeemed coupon',
      },
      occurredAt: params.occurredAt,
      manager: params.manager,
    });
  }

  async recordRefund(params: {
    businessId: number;
    customerId: number;
    orderId?: number | null;
    funnelPaymentId: number;
    amountCents: number;
    currency: string;
    occurredAt?: Date;
    manager?: EntityManager;
  }): Promise<void> {
    await this.record({
      businessId: params.businessId,
      customerId: params.customerId,
      activityType: CustomerActivityType.REFUND,
      source: CustomerActivitySource.ONLINE,
      referenceType:
        params.orderId != null
          ? CustomerActivityReferenceType.ORDER
          : CustomerActivityReferenceType.FUNNEL_PAYMENT,
      referenceId: params.orderId ?? params.funnelPaymentId,
      amount: params.amountCents,
      currency: params.currency || 'usd',
      idempotencyKey: `activity:refund:payment:${params.funnelPaymentId}`,
      metadata: {
        funnelPaymentId: params.funnelPaymentId,
        orderId: params.orderId ?? null,
        label: 'Refund',
      },
      occurredAt: params.occurredAt,
      manager: params.manager,
    });
  }

  async listForCustomer(params: {
    businessId: number;
    customerId: number;
    campaignId?: number | null;
    limit?: number;
  }): Promise<CustomerActivityTimelineItem[]> {
    const qb = this.customerActivityRepository
      .createQueryBuilder('activity')
      .where('activity.business_id = :businessId', {
        businessId: params.businessId,
      })
      .andWhere('activity.customer_id = :customerId', {
        customerId: params.customerId,
      })
      .orderBy('activity.created_at', 'DESC')
      .take(params.limit ?? 100);

    if (params.campaignId != null && params.campaignId > 0) {
      qb.andWhere(
        `(
          (activity.metadata->>'campaignId')::int = :campaignId
          OR activity.metadata @> :campaignIdsJson
        )`,
        {
          campaignId: params.campaignId,
          campaignIdsJson: JSON.stringify({ campaignIds: [params.campaignId] }),
        },
      );
    }

    const rows = await qb.getMany();
    return rows.map((row) => this.toTimelineItem(row));
  }

  toTimelineItem(row: CustomerActivity): CustomerActivityTimelineItem {
    const metaLabel =
      typeof row.metadata?.label === 'string' ? row.metadata.label : null;
    return {
      id: row.id,
      activityType: row.activityType,
      source: row.source,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      amount: row.amount,
      currency: row.currency,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
      label: metaLabel ?? this.defaultLabel(row.activityType),
    };
  }

  private defaultLabel(type: CustomerActivityType): string {
    switch (type) {
      case CustomerActivityType.ONLINE_SIGNUP:
        return 'Signed up for deal';
      case CustomerActivityType.ONLINE_PURCHASE:
        return 'Purchased online';
      case CustomerActivityType.IN_STORE_PURCHASE:
        return 'Purchased in store';
      case CustomerActivityType.REDEMPTION:
        return 'Redeemed coupon';
      case CustomerActivityType.REFUND:
        return 'Refund';
      default:
        return 'Activity';
    }
  }
}
