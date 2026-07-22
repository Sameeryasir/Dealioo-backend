import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
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
import { isScannerFunnelPayment } from '../../common/payment-provenance.util';
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
  CustomerVisitSource,
} from '../../db/entities/customer-visit.entity';
import { CouponPaymentStatus } from '../../db/entities/coupon.entity';
import { visitedActivityDescription } from './visited-activity-description.util';
import {
  ACTIVITY_IN_PERSON_FILTER,
  escapeIlikePattern,
  normalizeActivitySearch,
  resolveActivityDateRange,
  type ParsedActivityEventFilter,
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
  /** online = funnel Stripe prepaid; in_store = counter / physical pay */
  paymentChannel?: 'online' | 'in_store' | null;
  /** scanned = QR redeem visit logged in activity */
  visitChannel?: 'scanned' | null;
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
    const businessName = params.businessName.trim() || 'Business';
    const paymentLabel =
      params.coupon.paymentStatus === CouponPaymentStatus.PENDING
        ? 'pay at counter'
        : 'prepaid';
    const description = `Redeemed ${offerName} (${paymentLabel}) at ${businessName}`;

    const payload: CreateActivityEventDto = {
      businessId: params.businessId,
      customerId: params.customerId,
      eventType: ActivityEventType.REDEEMED_REWARD,
      description,
      idempotencyKey: `redeemed:coupon:${params.coupon.id}`,
      occurredAt: params.occurredAt,
      metadata: {
        couponId: params.coupon.id,
        campaignId: params.coupon.campaignId,
        offerName,
        businessName,
        paymentStatus: params.coupon.paymentStatus ?? null,
      },
    };

    if (params.manager) {
      await this.logInTransaction(params.manager, payload);
      return;
    }

    await this.logInTransaction(this.activityRepository.manager, payload);
  }

  async logVisited(params: LogVisitedDto): Promise<void> {
    const visitSource =
      params.visitSource ?? CustomerVisitSource.QR_REDEMPTION;
    const offerName = params.offerName?.trim() || null;
    const payload: CreateActivityEventDto = {
      businessId: params.businessId,
      customerId: params.customerId,
      eventType: ActivityEventType.VISITED,
      description: visitedActivityDescription(
        params.businessName,
        visitSource,
        offerName,
      ),
      idempotencyKey: `visited:coupon:${params.couponId}`,
      occurredAt: params.occurredAt,
      metadata: {
        couponId: params.couponId,
        visitSource,
        ...(offerName ? { offerName } : {}),
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
      relations: ['funnel', 'funnel.campaign', 'business'],
    });
    if (!payment) {
      return;
    }

    if (payment.status !== FunnelPaymentStatus.PAID) {
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

    let campaignName =
      payment.funnel?.campaign?.campaignName?.trim() || null;
    if (!campaignName && payment.campaignId) {
      const campaign = await this.campaignRepository.findOne({
        where: { id: payment.campaignId },
        select: ['id', 'campaignName'],
      });
      campaignName = campaign?.campaignName?.trim() || null;
    }

    const businessName =
      payment.business?.name?.trim() || 'Business';
    const amountLabel = formatMoney(payment.amount, payment.currency);
    const isScannerWalkIn = isScannerFunnelPayment(payment);

    const description = isScannerWalkIn
      ? `${amountLabel} · ${campaignName || 'Campaign'} at ${businessName}`
      : `${amountLabel} · ${campaignName || 'Campaign'}`;

    const payload: CreateActivityEventDto = {
      businessId: payment.businessId,
      customerId,
      eventType: ActivityEventType.PREPAID_FOR_OFFER,
      description,
      idempotencyKey: `prepaid:payment:${payment.id}`,
      occurredAt: params.occurredAt ?? payment.paidAt ?? new Date(),
      metadata: {
        funnelPaymentId: payment.id,
        amountCents: payment.amount,
        currency: payment.currency,
        funnelId: payment.funnelId,
        campaignId: payment.campaignId,
        campaignName: campaignName || null,
        businessName,
        source: isScannerWalkIn ? 'scanner_purchase' : 'online_payment',
        paymentSource: payment.paymentSource ?? null,
        collectionChannel: payment.collectionChannel ?? null,
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
      eventType?: ParsedActivityEventFilter;
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

      qb.andWhere(
        `NOT (
          activity.event_type = :hideVisitedType
          AND (
            COALESCE(activity.metadata->>'visitSource', '') = :hideStaffLookup
            OR activity.description ILIKE :hideCheckedInPrefix
          )
        )`,
        {
          hideVisitedType: ActivityEventType.VISITED,
          hideStaffLookup: CustomerVisitSource.STAFF_LOOKUP,
          hideCheckedInPrefix: 'Checked in at%',
        },
      );

      this.applyEventTypeFilter(qb, options.eventType);

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
      .andWhere(
        `NOT (
          activity.event_type = :hideVisitedType
          AND (
            COALESCE(activity.metadata->>'visitSource', '') = :hideStaffLookup
            OR activity.description ILIKE :hideCheckedInPrefix
          )
        )`,
        {
          hideVisitedType: ActivityEventType.VISITED,
          hideStaffLookup: CustomerVisitSource.STAFF_LOOKUP,
          hideCheckedInPrefix: 'Checked in at%',
        },
      )
      .getCount();

    const [rows, total] = await Promise.all([
      rowsQb
        .orderBy('activity.occurredAt', 'DESC')
        .skip(pagination.skip)
        .take(pagination.limit)
        .getMany(),
      countQb.getCount(),
    ]);

    const prepaidCampaignIds = Array.from(
      new Set(
        rows
          .filter(
            (row) => row.eventType === ActivityEventType.PREPAID_FOR_OFFER,
          )
          .map((row) => {
            const campaignId = row.metadata?.campaignId;
            return typeof campaignId === 'number' ? campaignId : null;
          })
          .filter((id): id is number => id != null && id > 0),
      ),
    );

    const campaignNameById = new Map<number, string>();
    if (prepaidCampaignIds.length > 0) {
      const campaigns = await this.campaignRepository.find({
        where: { id: In(prepaidCampaignIds) },
        select: ['id', 'campaignName'],
      });
      for (const campaign of campaigns) {
        const name = campaign.campaignName?.trim();
        if (name) {
          campaignNameById.set(campaign.id, name);
        }
      }
    }

    return {
      data: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        occurredAt: row.occurredAt.toISOString(),
        customerName: row.customer?.name?.trim() || null,
        customerEmail: row.customer?.email?.trim() || null,
        description: this.prepaidActivityDescription(row, campaignNameById),
        paymentChannel: this.resolvePaymentChannel(row),
        visitChannel: this.resolveVisitChannel(row),
      })),
      meta: {
        ...buildPaginationMeta(total, pagination.page, pagination.limit),
        allEventsTotal,
      },
    };
  }

  private readonly inStorePrepaidSql = `(
    COALESCE(activity.metadata->>'source', '') = 'scanner_purchase'
    OR COALESCE(activity.metadata->>'paymentSource', '') = 'SCANNER'
    OR COALESCE(activity.metadata->>'collectionChannel', '') = 'IN_STORE'
    OR activity.description ILIKE '% at %'
  )`;

  private applyEventTypeFilter(
    qb: ReturnType<Repository<ActivityEvent>['createQueryBuilder']>,
    eventType?: ParsedActivityEventFilter,
  ): void {
    if (!eventType) {
      return;
    }

    if (eventType === ACTIVITY_IN_PERSON_FILTER) {
      qb.andWhere('activity.eventType = :prepaidType', {
        prepaidType: ActivityEventType.PREPAID_FOR_OFFER,
      }).andWhere(this.inStorePrepaidSql);
      return;
    }

    if (eventType === ActivityEventType.PREPAID_FOR_OFFER) {
      qb.andWhere('activity.eventType = :prepaidType', {
        prepaidType: ActivityEventType.PREPAID_FOR_OFFER,
      }).andWhere(`NOT ${this.inStorePrepaidSql}`);
      return;
    }

    qb.andWhere('activity.eventType = :eventType', { eventType });
  }

  private resolvePaymentChannel(
    row: ActivityEvent,
  ): 'online' | 'in_store' | null {
    if (row.eventType !== ActivityEventType.PREPAID_FOR_OFFER) {
      return null;
    }
    const metadata = row.metadata ?? {};
    const source =
      typeof metadata.source === 'string' ? metadata.source.trim() : '';
    const paymentSource =
      typeof metadata.paymentSource === 'string'
        ? metadata.paymentSource.trim()
        : '';
    const collectionChannel =
      typeof metadata.collectionChannel === 'string'
        ? metadata.collectionChannel.trim()
        : '';

    if (
      source === 'scanner_purchase' ||
      paymentSource === 'SCANNER' ||
      collectionChannel === 'IN_STORE' ||
      row.description.includes(' at ')
    ) {
      return 'in_store';
    }
    return 'online';
  }

  // --- Visit channel (QR scan → Activity "Scanned" tag) ---
  private resolveVisitChannel(row: ActivityEvent): 'scanned' | null {
    if (row.eventType !== ActivityEventType.VISITED) {
      return null;
    }
    const metadata = row.metadata ?? {};
    const visitSource =
      typeof metadata.visitSource === 'string'
        ? metadata.visitSource.trim()
        : '';
    // Business rule: QR redeem check-ins show as Scanned in Activity Log
    if (
      visitSource === CustomerVisitSource.QR_REDEMPTION ||
      row.description.trim().toLowerCase().startsWith('scanned at')
    ) {
      return 'scanned';
    }
    return null;
  }

  private prepaidActivityDescription(
    row: ActivityEvent,
    campaignNameById: Map<number, string>,
  ): string {
    if (row.eventType !== ActivityEventType.PREPAID_FOR_OFFER) {
      return row.description;
    }

    const metadata = row.metadata ?? {};
    const currency =
      typeof metadata.currency === 'string' ? metadata.currency : 'usd';
    const amountCents =
      typeof metadata.amountCents === 'number' ? metadata.amountCents : null;
    const amountLabel =
      amountCents != null ? formatMoney(amountCents, currency) : null;

    const storedCampaignName =
      typeof metadata.campaignName === 'string'
        ? metadata.campaignName.trim()
        : '';
    const campaignId =
      typeof metadata.campaignId === 'number' ? metadata.campaignId : null;
    const campaignName =
      storedCampaignName ||
      (campaignId != null ? campaignNameById.get(campaignId) : undefined) ||
      '';

    if (amountLabel && campaignName) {
      return `${amountLabel} · ${campaignName}`;
    }

    if (amountLabel) {
      return amountLabel;
    }

    return row.description;
  }

  async getBusinessSummary(
    businessId: number,
    options: {
      eventType?: ParsedActivityEventFilter;
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
      .andWhere(
        `NOT (
          activity.event_type = :hideVisitedType
          AND (
            COALESCE(activity.metadata->>'visitSource', '') = :hideStaffLookup
            OR activity.description ILIKE :hideCheckedInPrefix
          )
        )`,
        {
          hideVisitedType: ActivityEventType.VISITED,
          hideStaffLookup: CustomerVisitSource.STAFF_LOOKUP,
          hideCheckedInPrefix: 'Checked in at%',
        },
      )
      .groupBy('activity.eventType');

    this.applyEventTypeFilter(qb, options.eventType);

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
