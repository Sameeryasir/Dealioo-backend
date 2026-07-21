import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  Repository,
} from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../common/pagination';
import {
  ActivityEvent,
  ActivityEventType,
} from '../../db/entities/activity-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { Business } from '../../db/entities/business.entity';
import {
  Campaign,
  CampaignPublicationStatus,
} from '../../db/entities/campaign.entity';
import { CreateActivityEventDto } from './activityDto/create-activity-event.dto';
import { LogMessageSentDto } from './activityDto/log-message-sent.dto';
import { LogPrepaidForOfferDto } from './activityDto/log-prepaid-for-offer.dto';
import { LogRedeemedRewardDto } from './activityDto/log-redeemed-reward.dto';
import { LogVisitedDto } from './activityDto/log-visited.dto';
import { truncateActivityMessagePreview } from '../../utils/truncate-activity-message';
import {
  escapeIlikePattern,
  normalizeActivitySearch,
  resolveActivityDateRange,
} from './activity-filters.util';
import {
  buildRecentMonthBuckets,
  clampOverviewMonths,
  monthKeyToMap,
} from '../funnel-event/overview-monthly.util';
import { PusherService } from '../pusher/pusher.service';

export type ActivityEventListItem = {
  id: number;
  eventType: ActivityEventType;
  occurredAt: string;
  customerName: string | null;
  customerEmail: string | null;
  description: string;
};

export type ActivitySummary = {
  totalEvents: number;
  totalVisited: number;
  totalRedeemed: number;
  totalPrepaid: number;
  totalMessagesSent: number;
  from: string;
  to: string;
};

export type ActivityMonthlyPoint = {
  month: string;
  totalEvents: number;
  checkIns: number;
  visited: number;
  redeemedReward: number;
  prepaidForOffer: number;
  messageSent: number;
  prepaidRevenueCents: number;
  orders: number;
  members: number;
};

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function formatMoney(amountCents: number, currency: string): string {
  const normalized = currency.trim().toLowerCase() || 'usd';
  if (normalized === 'usd') {
    return `$${(amountCents / 100).toFixed(2)}`;
  }
  return `${(amountCents / 100).toFixed(2)} ${normalized.toUpperCase()}`;
}

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityEvent)
    private readonly activityRepository: Repository<ActivityEvent>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    private readonly pusherService: PusherService,
  ) {}

  /**
   * Customers linked to a business via payments, visits, chats, or activity.
   * Customers table has no businessId, so membership is inferred from relations.
   */
  private businessCustomersBaseQuery(businessId: number) {
    return this.customerRepository
      .createQueryBuilder('customer')
      .where(
        `customer.id IN (
          SELECT activity.customer_id
          FROM activity_event activity
          WHERE activity.restaurant_id = :businessId
            AND activity.customer_id IS NOT NULL
          UNION
          SELECT conversation.customer_id
          FROM conversation conversation
          WHERE conversation.restaurant_id = :businessId
            AND conversation.customer_id IS NOT NULL
          UNION
          SELECT visit.customer_id
          FROM customer_visits visit
          WHERE visit.restaurant_id = :businessId
          UNION
          SELECT paid_customer.id
          FROM customers paid_customer
          INNER JOIN funnel_payment payment
            ON LOWER(payment.customer_email) = LOWER(paid_customer.email)
          WHERE payment.restaurant_id = :businessId
            AND payment.status = :paid
        )`,
        { businessId, paid: FunnelPaymentStatus.PAID },
      );
  }

  private async countBusinessCustomers(businessId: number): Promise<number> {
    const result = await this.businessCustomersBaseQuery(businessId)
      .select('COUNT(DISTINCT customer.id)', 'count')
      .getRawOne<{ count: string }>();
    return Number(result?.count ?? 0);
  }

  private async getBusinessActivitySnapshot(businessId: number): Promise<{
    activeCampaigns: number;
    totalOrders: number;
    totalMembers: number;
    todayRevenueCents: number;
  }> {
    const todayStart = startOfTodayUtc();

    const [activeCampaigns, totalOrders, totalMembers, todayRevenueRow] =
      await Promise.all([
        this.campaignRepository.count({
          where: {
            businessId,
            status: CampaignPublicationStatus.PUBLISHED,
          },
        }),
        this.funnelPaymentRepository.count({
          where: {
            businessId,
            status: FunnelPaymentStatus.PAID,
          },
        }),
        this.countBusinessCustomers(businessId),
        this.funnelPaymentRepository
          .createQueryBuilder('payment')
          .select('COALESCE(SUM(payment.amount), 0)', 'revenue')
          .where('payment.businessId = :businessId', { businessId })
          .andWhere('payment.status = :paid', { paid: FunnelPaymentStatus.PAID })
          .andWhere(
            'COALESCE(payment.paidAt, payment.createdAt) >= :todayStart',
            { todayStart },
          )
          .getRawOne<{ revenue: string }>(),
      ]);

    return {
      activeCampaigns,
      totalOrders,
      totalMembers,
      todayRevenueCents: Number(todayRevenueRow?.revenue ?? 0),
    };
  }

  async logInTransaction(
    manager: EntityManager,
    params: CreateActivityEventDto,
  ): Promise<void> {
    const existing = await manager.findOne(ActivityEvent, {
      where: { idempotencyKey: params.idempotencyKey },
      select: ['id'],
    });
    if (existing) {
      return;
    }

    await manager.save(
      ActivityEvent,
      manager.create(ActivityEvent, {
        businessId: params.businessId,
        customerId: params.customerId,
        eventType: params.eventType,
        description: params.description,
        metadata: params.metadata ?? null,
        occurredAt: params.occurredAt ?? new Date(),
        idempotencyKey: params.idempotencyKey,
      }),
    );
  }

  async logRedeemedReward(params: LogRedeemedRewardDto): Promise<void> {
    const offerName =
      params.coupon.campaign?.offer?.trim() ||
      params.coupon.campaign?.campaignName?.trim() ||
      'Reward';

    const payload: CreateActivityEventDto = {
      businessId: params.businessId,
      customerId: params.customerId,
      eventType: ActivityEventType.REDEEMED_REWARD,
      description: offerName,
      idempotencyKey: `redeemed:coupon:${params.coupon.id}`,
      occurredAt: params.occurredAt,
      metadata: {
        couponId: params.coupon.id,
        campaignId: params.coupon.campaignId,
        offerName,
      },
    };

    if (params.manager) {
      await this.logInTransaction(params.manager, payload);
      return;
    }

    await this.logInTransaction(this.activityRepository.manager, payload);
  }

  async logVisited(params: LogVisitedDto): Promise<void> {
    const payload: CreateActivityEventDto = {
      businessId: params.businessId,
      customerId: params.customerId,
      eventType: ActivityEventType.VISITED,
      description: `Scanned at ${params.businessName}`,
      idempotencyKey: `visited:coupon:${params.couponId}`,
      occurredAt: params.occurredAt,
      metadata: {
        couponId: params.couponId,
      },
    };

    if (params.manager) {
      await this.logInTransaction(params.manager, payload);
      return;
    }

    await this.logInTransaction(this.activityRepository.manager, payload);
  }

  async logPrepaidForOffer(params: LogPrepaidForOfferDto): Promise<void> {
    const payment = await this.funnelPaymentRepository.findOne({
      where: { id: params.paymentId },
      relations: ['business'],
    });
    if (!payment) {
      return;
    }

    let customerId = params.customerId ?? null;
    if (customerId == null && payment.customerEmail?.trim()) {
      const customer = await this.customerRepository.findOne({
        where: { email: payment.customerEmail.trim() },
        select: ['id'],
      });
      customerId = customer?.id ?? null;
    }

    const businessName =
      payment.business?.name?.trim() || 'Unknown location';
    const amountLabel = formatMoney(payment.amount, payment.currency);

    const payload: CreateActivityEventDto = {
      businessId: payment.businessId,
      customerId,
      eventType: ActivityEventType.PREPAID_FOR_OFFER,
      description: `${amountLabel} at ${businessName}`,
      idempotencyKey: `prepaid:payment:${payment.id}`,
      occurredAt: params.occurredAt ?? payment.paidAt ?? new Date(),
      metadata: {
        funnelPaymentId: payment.id,
        amountCents: payment.amount,
        currency: payment.currency,
        funnelId: payment.funnelId,
        campaignId: payment.campaignId,
      },
    };

    await this.logInTransaction(this.activityRepository.manager, payload);
  }

  async logMessageSent(params: LogMessageSentDto): Promise<void> {
    const payload: CreateActivityEventDto = {
      businessId: params.businessId,
      customerId: params.customerId,
      eventType: ActivityEventType.MESSAGE_SENT,
      description: truncateActivityMessagePreview(params.messagePreview),
      idempotencyKey: params.idempotencyKey,
      occurredAt: params.occurredAt,
      metadata: params.metadata ?? null,
    };

    if (params.manager) {
      await this.logInTransaction(params.manager, payload);
      return;
    }

    await this.logInTransaction(this.activityRepository.manager, payload);
  }

  async getBusinessEvents(
    businessId: number,
    options: {
      page?: number;
      limit?: number;
      eventType?: ActivityEventType | null;
      from?: Date | null;
      to?: Date | null;
      search?: string;
    },
  ): Promise<{
    data: ActivityEventListItem[];
    meta: ReturnType<typeof buildPaginationMeta> & { allEventsTotal: number };
  }> {
    const pagination = normalizePagination(options.page, options.limit);
    const range = resolveActivityDateRange(options.from, options.to);
    const search = normalizeActivitySearch(options.search);

    const applyBaseFilters = (
      qb: ReturnType<Repository<ActivityEvent>['createQueryBuilder']>,
    ) => {
      qb.where('activity.businessId = :businessId', { businessId })
        .andWhere('activity.occurredAt >= :from', { from: range.from })
        .andWhere('activity.occurredAt <= :to', { to: range.to });

      if (options.eventType) {
        qb.andWhere('activity.eventType = :eventType', {
          eventType: options.eventType,
        });
      }

      if (search) {
        const searchPattern = `%${escapeIlikePattern(search)}%`;
        qb.andWhere(
          `(
            COALESCE(customer.name, '') ILIKE :searchPattern
            OR COALESCE(customer.email, '') ILIKE :searchPattern
            OR COALESCE(activity.description, '') ILIKE :searchPattern
          )`,
          { searchPattern },
        );
      }
    };

    const countQb = this.activityRepository
      .createQueryBuilder('activity')
      .leftJoin('activity.customer', 'customer');
    applyBaseFilters(countQb);

    const rowsQb = this.activityRepository
      .createQueryBuilder('activity')
      .leftJoinAndSelect('activity.customer', 'customer');
    applyBaseFilters(rowsQb);

    const allEventsTotal = await this.activityRepository
      .createQueryBuilder('activity')
      .where('activity.businessId = :businessId', { businessId })
      .andWhere('activity.occurredAt >= :from', { from: range.from })
      .andWhere('activity.occurredAt <= :to', { to: range.to })
      .getCount();

    const [rows, total] = await Promise.all([
      rowsQb
        .orderBy('activity.occurredAt', 'DESC')
        .skip(pagination.skip)
        .take(pagination.limit)
        .getMany(),
      countQb.getCount(),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        occurredAt: row.occurredAt.toISOString(),
        customerName: row.customer?.name?.trim() || null,
        customerEmail: row.customer?.email?.trim() || null,
        description: row.description,
      })),
      meta: {
        ...buildPaginationMeta(total, pagination.page, pagination.limit),
        allEventsTotal,
      },
    };
  }

  async getBusinessSummary(
    businessId: number,
    options: {
      eventType?: ActivityEventType | null;
      from?: Date | null;
      to?: Date | null;
    },
  ): Promise<ActivitySummary> {
    const range = resolveActivityDateRange(options.from, options.to);

    const qb = this.activityRepository
      .createQueryBuilder('activity')
      .select('activity.eventType', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .where('activity.businessId = :businessId', { businessId })
      .andWhere('activity.occurredAt >= :from', { from: range.from })
      .andWhere('activity.occurredAt <= :to', { to: range.to })
      .groupBy('activity.eventType');

    if (options.eventType) {
      qb.andWhere('activity.eventType = :eventType', {
        eventType: options.eventType,
      });
    }

    const rows = await qb.getRawMany<{ eventType: ActivityEventType; count: string }>();

    let totalVisited = 0;
    let totalRedeemed = 0;
    let totalPrepaid = 0;
    let totalMessagesSent = 0;

    for (const row of rows) {
      const count = Number.parseInt(row.count, 10) || 0;
      switch (row.eventType) {
        case ActivityEventType.VISITED:
          totalVisited = count;
          break;
        case ActivityEventType.REDEEMED_REWARD:
          totalRedeemed = count;
          break;
        case ActivityEventType.PREPAID_FOR_OFFER:
          totalPrepaid = count;
          break;
        case ActivityEventType.MESSAGE_SENT:
          totalMessagesSent = count;
          break;
        default:
          break;
      }
    }

    return {
      totalEvents:
        totalVisited + totalRedeemed + totalPrepaid + totalMessagesSent,
      totalVisited,
      totalRedeemed,
      totalPrepaid,
      totalMessagesSent,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    };
  }

  async getBusinessSummaryMonthly(
    businessId: number,
    rawMonthCount?: number,
  ): Promise<{
    businessId: number;
    months: number;
    activeCampaigns: number;
    totalOrders: number;
    totalMembers: number;
    todayRevenueCents: number;
    data: ActivityMonthlyPoint[];
  }> {
    const monthCount = clampOverviewMonths(rawMonthCount);
    const buckets = buildRecentMonthBuckets(monthCount);
    const snapshot = await this.getBusinessActivitySnapshot(businessId);

    if (buckets.length === 0) {
      return {
        businessId,
        months: monthCount,
        ...snapshot,
        data: [],
      };
    }

    const rangeStart = buckets[0]!.start;

    const [rows, orderRows, memberRows] = await Promise.all([
      this.activityRepository
        .createQueryBuilder('activity')
        .select(
          `TO_CHAR(DATE_TRUNC('month', activity.occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM')`,
          'month',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE activity.event_type = :visited)`,
          'visited',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE activity.event_type = :redeemed)`,
          'redeemedReward',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE activity.event_type = :prepaid)`,
          'prepaidForOffer',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE activity.event_type = :message)`,
          'messageSent',
        )
        .addSelect(
          `COALESCE(SUM(
          CASE
            WHEN activity.event_type = :prepaid
            THEN NULLIF(activity.metadata->>'amountCents', '')::int
            ELSE 0
          END
        ), 0)`,
          'prepaidRevenueCents',
        )
        .where('activity.businessId = :businessId', { businessId })
        .andWhere('activity.occurredAt >= :rangeStart', { rangeStart })
        .groupBy(`DATE_TRUNC('month', activity.occurred_at AT TIME ZONE 'UTC')`)
        .setParameters({
          visited: ActivityEventType.VISITED,
          redeemed: ActivityEventType.REDEEMED_REWARD,
          prepaid: ActivityEventType.PREPAID_FOR_OFFER,
          message: ActivityEventType.MESSAGE_SENT,
        })
        .getRawMany<{
          month: string;
          visited: string;
          redeemedReward: string;
          prepaidForOffer: string;
          messageSent: string;
          prepaidRevenueCents: string;
        }>(),
      this.funnelPaymentRepository
        .createQueryBuilder('payment')
        .select(
          `TO_CHAR(DATE_TRUNC('month', COALESCE(payment.paid_at, payment.created_at) AT TIME ZONE 'UTC'), 'YYYY-MM')`,
          'month',
        )
        .addSelect('COUNT(*)', 'orders')
        .where('payment.businessId = :businessId', { businessId })
        .andWhere('payment.status = :paid', { paid: FunnelPaymentStatus.PAID })
        .andWhere(
          'COALESCE(payment.paidAt, payment.createdAt) >= :rangeStart',
          { rangeStart },
        )
        .groupBy(
          `DATE_TRUNC('month', COALESCE(payment.paid_at, payment.created_at) AT TIME ZONE 'UTC')`,
        )
        .getRawMany<{ month: string; orders: string }>(),
      this.businessCustomersBaseQuery(businessId)
        .select(
          `TO_CHAR(DATE_TRUNC('month', customer.created_at AT TIME ZONE 'UTC'), 'YYYY-MM')`,
          'month',
        )
        .addSelect('COUNT(*)', 'members')
        .andWhere('customer.createdAt >= :rangeStart', { rangeStart })
        .groupBy(
          `DATE_TRUNC('month', customer.created_at AT TIME ZONE 'UTC')`,
        )
        .getRawMany<{ month: string; members: string }>(),
    ]);

    const byMonth = monthKeyToMap(rows);
    const ordersByMonth = monthKeyToMap(orderRows);
    const membersByMonth = monthKeyToMap(memberRows);

    const data = buckets.map((bucket) => {
      const row = byMonth.get(bucket.month);
      const orderRow = ordersByMonth.get(bucket.month);
      const memberRow = membersByMonth.get(bucket.month);
      const visited = Number(row?.visited ?? 0);
      const redeemedReward = Number(row?.redeemedReward ?? 0);
      const prepaidForOffer = Number(row?.prepaidForOffer ?? 0);
      const messageSent = Number(row?.messageSent ?? 0);

      const checkIns = visited + redeemedReward;

      return {
        month: bucket.month,
        totalEvents: checkIns + prepaidForOffer + messageSent,
        checkIns,
        visited,
        redeemedReward,
        prepaidForOffer,
        messageSent,
        prepaidRevenueCents: Number(row?.prepaidRevenueCents ?? 0),
        orders: Number(orderRow?.orders ?? 0),
        members: Number(memberRow?.members ?? 0),
      };
    });

    return {
      businessId,
      months: monthCount,
      ...snapshot,
      data,
    };
  }
}
