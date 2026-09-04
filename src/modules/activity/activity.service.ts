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
  CampaignType,
} from '../../db/entities/campaign.entity';
import { CreateActivityEventDto } from './activityDto/create-activity-event.dto';
import { LogMessageSentDto } from './activityDto/log-message-sent.dto';
import { LogPrepaidForOfferDto } from './activityDto/log-prepaid-for-offer.dto';
import { LogRedeemedRewardDto } from './activityDto/log-redeemed-reward.dto';
import { LogSignedUpDto } from './activityDto/log-signed-up.dto';
import { LogVisitedDto } from './activityDto/log-visited.dto';
import { truncateActivityMessagePreview } from '../../utils/truncate-activity-message';
import {
  CustomerVisitSource,
} from '../../db/entities/customer-visit.entity';
import { CouponPaymentStatus } from '../../db/entities/coupon.entity';
import { visitedActivityDescription } from './visited-activity-description.util';
import {
  ACTIVITY_IN_PERSON_FILTER,
  ACTIVITY_IN_STORE_PREPAID_SQL,
  escapeIlikePattern,
  normalizeActivitySearch,
  resolveActivityDateRange,
  type ParsedActivityEventFilter,
} from './activity-filters.util';
import {
  ACTIVITY_PAYMENT_PLACE,
  resolveActivityPaymentPlace,
} from './activity-payment-place.util';
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
  paymentChannel?: 'online' | 'in_store' | null;
  campaignType?: 'prepaid' | 'postpaid' | null;
  visitChannel?: 'scanned' | 'in_store' | null;
};

export type ActivitySummary = {
  totalEvents: number;
  totalVisited: number;
  totalRedeemed: number;
  totalPrepaid: number;
  totalInPerson: number;
  totalSignedUp: number;
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
          WHERE activity.business_id = :businessId
            AND activity.customer_id IS NOT NULL
          UNION
          SELECT conversation.customer_id
          FROM conversation conversation
          WHERE conversation.business_id = :businessId
            AND conversation.customer_id IS NOT NULL
          UNION
          SELECT visit.customer_id
          FROM customer_visits visit
          WHERE visit.business_id = :businessId
          UNION
          SELECT paid_customer.id
          FROM customers paid_customer
          INNER JOIN funnel_payment payment
            ON LOWER(payment.customer_email) = LOWER(paid_customer.email)
          WHERE payment.business_id = :businessId
            AND payment.status = :paid
        )`,
        { businessId, paid: FunnelPaymentStatus.PAID },
      );
  }

  /**
   * Distinct customers linked to a business via activity, chats, visits, or paid funnels.
   * Used by activity snapshots and business detail summary.
   */
  async countBusinessCustomers(businessId: number): Promise<number> {
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

    try {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('UQ_activity_event_idempotency') ||
        message.includes('duplicate key')
      ) {
        return;
      }
      throw err;
    }
  }

  async logSignedUp(params: LogSignedUpDto): Promise<void> {
    const campaignName = params.campaignName?.trim() || 'Campaign';
    const campaignTypeRaw = params.campaignType?.trim().toLowerCase() || '';
    const description = `Signed up · ${campaignName}`;
    const occurredAt = params.occurredAt ?? new Date();
    const idempotencyKey = `signup:funnel:${params.funnelId}:customer:${params.customerId}`;

    const manager = this.activityRepository.manager;
    const existing = await manager.findOne(ActivityEvent, {
      where: { idempotencyKey },
      select: ['id'],
    });
    if (existing) {
      await manager.update(ActivityEvent, existing.id, {
        description,
        occurredAt,
        metadata: {
          funnelId: params.funnelId,
          campaignId: params.campaignId ?? null,
          campaignName,
          campaignType: campaignTypeRaw || null,
        },
      });
      return;
    }

    const payload: CreateActivityEventDto = {
      businessId: params.businessId,
      customerId: params.customerId,
      eventType: ActivityEventType.SIGNED_UP,
      description,
      idempotencyKey,
      occurredAt,
      metadata: {
        funnelId: params.funnelId,
        campaignId: params.campaignId ?? null,
        campaignName,
        campaignType: campaignTypeRaw || null,
      },
    };

    await this.logInTransaction(manager, payload);
  }

  async logRedeemedReward(params: LogRedeemedRewardDto): Promise<void> {
    const offerName =
      params.coupon.campaign?.offer?.trim() ||
      params.coupon.campaign?.campaignName?.trim() ||
      'Reward';
    const businessName = params.businessName.trim() || 'Business';
    const paymentStatus =
      params.paymentStatusOverride ?? params.coupon.paymentStatus ?? null;
    const paidAtCounter = params.paidAtCounter === true;
    const paymentLabel =
      paymentStatus === CouponPaymentStatus.PENDING ||
      paymentStatus === CouponPaymentStatus.FAILED
        ? 'Unpaid'
        : paidAtCounter
          ? 'Paid at counter'
          : paymentStatus === CouponPaymentStatus.PAID
            ? 'Paid'
            : 'Paid';
    const description = `Redeemed ${offerName} · ${paymentLabel} at ${businessName}`;

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
        campaignType: params.coupon.campaign?.campaignType ?? null,
        paymentStatus,
        ...(paidAtCounter ? { paidAtCounter: true } : {}),
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

  async logPrepaidForOffer(
    params: LogPrepaidForOfferDto & { manager?: EntityManager },
  ): Promise<void> {
    const manager = params.manager ?? this.activityRepository.manager;
    const payment = await manager.findOne(FunnelPayment, {
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
      const customer = await manager.findOne(Customer, {
        where: { email: payment.customerEmail.trim() },
        select: ['id'],
      });
      customerId = customer?.id ?? null;
    }

    let campaignName =
      payment.funnel?.campaign?.campaignName?.trim() || null;
    let offerName = payment.funnel?.campaign?.offer?.trim() || null;
    let campaignType =
      payment.funnel?.campaign?.campaignType === CampaignType.POSTPAID
        ? CampaignType.POSTPAID
        : payment.funnel?.campaign?.campaignType === CampaignType.PREPAID
          ? CampaignType.PREPAID
          : null;
    if ((!campaignName || !offerName || !campaignType) && payment.campaignId) {
      const campaign = await manager.findOne(Campaign, {
        where: { id: payment.campaignId },
        select: ['id', 'campaignName', 'campaignType', 'offer'],
      });
      campaignName = campaignName || campaign?.campaignName?.trim() || null;
      offerName = offerName || campaign?.offer?.trim() || null;
      if (!campaignType) {
        campaignType =
          campaign?.campaignType === CampaignType.POSTPAID
            ? CampaignType.POSTPAID
            : campaign?.campaignType === CampaignType.PREPAID
              ? CampaignType.PREPAID
              : null;
      }
    }

    const businessName =
      payment.business?.name?.trim() || 'Business';
    const amountLabel = formatMoney(payment.amount, payment.currency);
    const isScannerWalkIn = isScannerFunnelPayment(payment);
    const paymentPlace = resolveActivityPaymentPlace({
      isInStore: isScannerWalkIn,
    });
    const counterExtrasOnly = params.counterExtrasOnly === true;
    const extraItemsCents = counterExtrasOnly
      ? Math.max(0, Math.round(payment.amount ?? 0))
      : params.extraItemsCents != null &&
          Number.isFinite(params.extraItemsCents) &&
          params.extraItemsCents > 0
        ? Math.round(params.extraItemsCents)
        : 0;
    const offerCents = counterExtrasOnly
      ? 0
      : Math.max(0, Math.round(payment.amount ?? 0));
    const offerLabel = offerName || campaignName || 'Offer';
    const paymentPlaceLabel =
      paymentPlace === ACTIVITY_PAYMENT_PLACE.IN_STORE
        ? 'Paid at counter'
        : 'Paid online';

    let moneyLabel = '';
    if (counterExtrasOnly && extraItemsCents > 0) {
      moneyLabel = `${formatMoney(extraItemsCents, payment.currency)} counter extras`;
    } else if (offerCents > 0 && extraItemsCents > 0) {
      moneyLabel = `${formatMoney(offerCents, payment.currency)} offer + ${formatMoney(extraItemsCents, payment.currency)} extras`;
    } else if (offerCents > 0) {
      moneyLabel = `${formatMoney(offerCents, payment.currency)} offer`;
    } else if (extraItemsCents > 0) {
      moneyLabel = `${formatMoney(extraItemsCents, payment.currency)} extras`;
    } else {
      moneyLabel = amountLabel;
    }

    const detailParts = [moneyLabel, paymentPlaceLabel, offerLabel];
    const description =
      paymentPlace === ACTIVITY_PAYMENT_PLACE.IN_STORE
        ? `${detailParts.join(' · ')} at ${businessName}`
        : detailParts.join(' · ');

    const payload: CreateActivityEventDto = {
      businessId: payment.businessId,
      customerId,
      eventType: ActivityEventType.PREPAID_FOR_OFFER,
      description,
      idempotencyKey: `prepaid:payment:${payment.id}`,
      occurredAt: params.occurredAt ?? payment.paidAt ?? new Date(),
      metadata: {
        funnelPaymentId: payment.id,
        amountCents: offerCents,
        ...(extraItemsCents > 0 ? { extraItemsCents } : {}),
        ...(counterExtrasOnly ? { counterExtrasOnly: true } : {}),
        currency: payment.currency,
        funnelId: payment.funnelId,
        campaignId: payment.campaignId,
        campaignName: campaignName || null,
        offerName: offerName || null,
        campaignType,
        businessName,
        paymentPlace,
        source:
          paymentPlace === ACTIVITY_PAYMENT_PLACE.IN_STORE
            ? 'scanner_purchase'
            : 'online_payment',
        paymentSource: payment.paymentSource ?? null,
        collectionChannel: payment.collectionChannel ?? null,
      },
    };

    await this.logInTransaction(manager, payload);
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
      .getCount();

    const [rows, total] = await Promise.all([
      rowsQb
        .orderBy('activity.occurredAt', 'DESC')
        .addOrderBy('activity.id', 'DESC')
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
    const campaignOfferById = new Map<number, string>();
    const campaignTypeById = new Map<number, CampaignType>();
    if (prepaidCampaignIds.length > 0) {
      const campaigns = await this.campaignRepository.find({
        where: { id: In(prepaidCampaignIds) },
        select: ['id', 'campaignName', 'campaignType', 'offer'],
      });
      for (const campaign of campaigns) {
        const name = campaign.campaignName?.trim();
        if (name) {
          campaignNameById.set(campaign.id, name);
        }
        const offer = campaign.offer?.trim();
        if (offer) {
          campaignOfferById.set(campaign.id, offer);
        }
        if (
          campaign.campaignType === CampaignType.POSTPAID ||
          campaign.campaignType === CampaignType.PREPAID
        ) {
          campaignTypeById.set(campaign.id, campaign.campaignType);
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
        description: this.prepaidActivityDescription(
          row,
          campaignNameById,
          campaignTypeById,
          campaignOfferById,
        ),
        paymentChannel: this.resolvePaymentChannel(row),
        campaignType: this.resolveCampaignType(row, campaignTypeById),
        visitChannel: this.resolveVisitChannel(row),
      })),
      meta: {
        ...buildPaginationMeta(total, pagination.page, pagination.limit),
        allEventsTotal,
      },
    };
  }

  private readonly inStorePrepaidSql = ACTIVITY_IN_STORE_PREPAID_SQL;

  private applyEventTypeFilter(
    qb: ReturnType<Repository<ActivityEvent>['createQueryBuilder']>,
    eventType?: ParsedActivityEventFilter,
  ): void {
    if (!eventType) {
      return;
    }

    if (eventType === ACTIVITY_IN_PERSON_FILTER) {
      qb.andWhere(
        `(activity.eventType = :prepaidType AND ${this.inStorePrepaidSql})`,
        {
          prepaidType: ActivityEventType.PREPAID_FOR_OFFER,
        },
      );
      return;
    }

    if (eventType === ActivityEventType.PREPAID_FOR_OFFER) {
      qb.andWhere('activity.eventType = :prepaidType', {
        prepaidType: ActivityEventType.PREPAID_FOR_OFFER,
      }).andWhere(`NOT ${this.inStorePrepaidSql}`);
      return;
    }

    if (eventType === ActivityEventType.VISITED) {
      qb.andWhere('activity.eventType = :visitedType', {
        visitedType: ActivityEventType.VISITED,
      });
      return;
    }

    qb.andWhere('activity.eventType = :eventType', { eventType });
  }

  private resolveCampaignType(
    row: ActivityEvent,
    campaignTypeById: Map<number, CampaignType>,
  ): 'prepaid' | 'postpaid' | null {
    if (row.eventType !== ActivityEventType.PREPAID_FOR_OFFER) {
      return null;
    }
    const metadata = row.metadata ?? {};
    const fromMeta =
      typeof metadata.campaignType === 'string'
        ? metadata.campaignType.trim().toLowerCase()
        : '';
    if (fromMeta === CampaignType.POSTPAID || fromMeta === CampaignType.PREPAID) {
      return fromMeta;
    }
    const campaignId =
      typeof metadata.campaignId === 'number' ? metadata.campaignId : null;
    if (campaignId != null) {
      return campaignTypeById.get(campaignId) ?? null;
    }
    return null;
  }

  private resolvePaymentChannel(
    row: ActivityEvent,
  ): 'online' | 'in_store' | null {
    if (row.eventType !== ActivityEventType.PREPAID_FOR_OFFER) {
      return null;
    }
    const metadata = row.metadata ?? {};
    const paymentPlace =
      typeof metadata.paymentPlace === 'string'
        ? metadata.paymentPlace.trim().toUpperCase()
        : '';
    const source =
      typeof metadata.source === 'string' ? metadata.source.trim() : '';
    const paymentSource =
      typeof metadata.paymentSource === 'string'
        ? metadata.paymentSource.trim().toUpperCase()
        : '';
    const collectionChannel =
      typeof metadata.collectionChannel === 'string'
        ? metadata.collectionChannel.trim().toUpperCase()
        : '';

    if (
      paymentPlace === ACTIVITY_PAYMENT_PLACE.IN_STORE ||
      source === 'scanner_purchase' ||
      paymentSource === 'SCANNER' ||
      collectionChannel === 'IN_STORE'
    ) {
      return 'in_store';
    }

    if (
      paymentPlace === ACTIVITY_PAYMENT_PLACE.ONLINE ||
      source === 'online_payment' ||
      paymentSource === 'STRIPE' ||
      collectionChannel === 'ONLINE'
    ) {
      return 'online';
    }

    return 'online';
  }

  private resolveVisitChannel(row: ActivityEvent): 'scanned' | 'in_store' | null {
    if (row.eventType !== ActivityEventType.VISITED) {
      return null;
    }
    const metadata = row.metadata ?? {};
    const visitSource =
      typeof metadata.visitSource === 'string'
        ? metadata.visitSource.trim()
        : '';
    if (
      visitSource === CustomerVisitSource.QR_REDEMPTION ||
      row.description.trim().toLowerCase().startsWith('scanned')
    ) {
      return 'scanned';
    }
    if (
      visitSource === CustomerVisitSource.STAFF_LOOKUP ||
      row.description.trim().toLowerCase().startsWith('checked in')
    ) {
      return 'in_store';
    }
    return null;
  }

  private redeemedActivityDescription(row: ActivityEvent): string {
    const metadata = row.metadata ?? {};
    const paymentStatusRaw =
      typeof metadata.paymentStatus === 'string'
        ? metadata.paymentStatus.trim().toUpperCase()
        : '';
    const paidAtCounter = metadata.paidAtCounter === true;
    const offerName =
      typeof metadata.offerName === 'string' && metadata.offerName.trim()
        ? metadata.offerName.trim()
        : null;
    const businessName =
      typeof metadata.businessName === 'string' && metadata.businessName.trim()
        ? metadata.businessName.trim()
        : null;

    let paymentLabel: string | null = null;
    if (
      paymentStatusRaw === CouponPaymentStatus.PENDING ||
      paymentStatusRaw === CouponPaymentStatus.FAILED
    ) {
      paymentLabel = 'Unpaid';
    } else if (paidAtCounter) {
      paymentLabel = 'Paid at counter';
    } else if (paymentStatusRaw === CouponPaymentStatus.PAID) {
      paymentLabel = 'Paid';
    }

    if (offerName && businessName && paymentLabel) {
      return `Redeemed ${offerName} · ${paymentLabel} at ${businessName}`;
    }

    const raw = row.description?.trim() || '';
    return raw
      .replace(/\s*·\s*Prepaid\s*/gi, ' · ')
      .replace(/\s*·\s*Postpaid\s*/gi, ' · ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s·\s·/g, ' · ')
      .trim();
  }

  private prepaidActivityDescription(
    row: ActivityEvent,
    campaignNameById: Map<number, string>,
    _campaignTypeById: Map<number, CampaignType>,
    campaignOfferById: Map<number, string> = new Map(),
  ): string {
    if (row.eventType === ActivityEventType.REDEEMED_REWARD) {
      return this.redeemedActivityDescription(row);
    }

    if (row.eventType !== ActivityEventType.PREPAID_FOR_OFFER) {
      return row.description;
    }

    const metadata = row.metadata ?? {};
    const currency =
      typeof metadata.currency === 'string' ? metadata.currency : 'usd';
    const counterExtrasOnly = metadata.counterExtrasOnly === true;
    const amountCents =
      typeof metadata.amountCents === 'number' ? metadata.amountCents : null;
    const extraItemsCents =
      typeof metadata.extraItemsCents === 'number' &&
      Number.isFinite(metadata.extraItemsCents) &&
      metadata.extraItemsCents > 0
        ? Math.round(metadata.extraItemsCents)
        : 0;

    let moneyLabel = '';
    if (counterExtrasOnly && extraItemsCents > 0) {
      moneyLabel = `${formatMoney(extraItemsCents, currency)} counter extras`;
    } else if (
      amountCents != null &&
      amountCents > 0 &&
      extraItemsCents > 0
    ) {
      moneyLabel = `${formatMoney(amountCents, currency)} offer + ${formatMoney(extraItemsCents, currency)} extras`;
    } else if (amountCents != null && amountCents > 0) {
      moneyLabel = `${formatMoney(amountCents, currency)} offer`;
    } else if (extraItemsCents > 0) {
      moneyLabel = `${formatMoney(extraItemsCents, currency)} extras`;
    } else if (amountCents != null) {
      moneyLabel = formatMoney(amountCents, currency);
    }

    const storedOfferName =
      typeof metadata.offerName === 'string' ? metadata.offerName.trim() : '';
    const storedCampaignName =
      typeof metadata.campaignName === 'string'
        ? metadata.campaignName.trim()
        : '';
    const campaignId =
      typeof metadata.campaignId === 'number' ? metadata.campaignId : null;
    const offerLabel =
      storedOfferName ||
      (campaignId != null ? campaignOfferById.get(campaignId) : undefined) ||
      storedCampaignName ||
      (campaignId != null ? campaignNameById.get(campaignId) : undefined) ||
      '';

    const businessName =
      typeof metadata.businessName === 'string'
        ? metadata.businessName.trim()
        : '';
    const isInStore = this.resolvePaymentChannel(row) === 'in_store';
    const paymentPlaceLabel = isInStore ? 'Paid at counter' : 'Paid online';

    const detailParts = [
      ...(moneyLabel ? [moneyLabel] : []),
      paymentPlaceLabel,
      ...(offerLabel ? [offerLabel] : []),
    ];

    if (detailParts.length === 0) {
      return row.description;
    }

    if (isInStore && businessName) {
      return `${detailParts.join(' · ')} at ${businessName}`;
    }

    return detailParts.join(' · ');
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
      .select(
        `COUNT(*) FILTER (WHERE activity.eventType = :countVisited)`,
        'totalVisited',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE activity.eventType = :countRedeemed)`,
        'totalRedeemed',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE activity.eventType = :countPrepaid AND NOT ${this.inStorePrepaidSql})`,
        'totalPrepaid',
      )
      .addSelect(
        `COUNT(*) FILTER (
          WHERE activity.eventType = :countPrepaid AND ${this.inStorePrepaidSql}
        )`,
        'totalInPerson',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE activity.eventType = :countSignedUp)`,
        'totalSignedUp',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE activity.eventType = :countMessage)`,
        'totalMessagesSent',
      )
      .where('activity.businessId = :businessId', { businessId })
      .andWhere('activity.occurredAt >= :from', { from: range.from })
      .andWhere('activity.occurredAt <= :to', { to: range.to })
      .setParameters({
        countVisited: ActivityEventType.VISITED,
        countRedeemed: ActivityEventType.REDEEMED_REWARD,
        countPrepaid: ActivityEventType.PREPAID_FOR_OFFER,
        countSignedUp: ActivityEventType.SIGNED_UP,
        countMessage: ActivityEventType.MESSAGE_SENT,
      });

    this.applyEventTypeFilter(qb, options.eventType);

    const row = await qb.getRawOne<{
      totalVisited: string;
      totalRedeemed: string;
      totalPrepaid: string;
      totalInPerson: string;
      totalSignedUp: string;
      totalMessagesSent: string;
    }>();

    const totalVisited = Number.parseInt(row?.totalVisited ?? '0', 10) || 0;
    const totalRedeemed = Number.parseInt(row?.totalRedeemed ?? '0', 10) || 0;
    const totalPrepaid = Number.parseInt(row?.totalPrepaid ?? '0', 10) || 0;
    const totalInPerson = Number.parseInt(row?.totalInPerson ?? '0', 10) || 0;
    const totalSignedUp = Number.parseInt(row?.totalSignedUp ?? '0', 10) || 0;
    const totalMessagesSent =
      Number.parseInt(row?.totalMessagesSent ?? '0', 10) || 0;

    return {
      totalEvents:
        totalVisited +
        totalRedeemed +
        totalPrepaid +
        totalInPerson +
        totalSignedUp +
        totalMessagesSent,
      totalVisited,
      totalRedeemed,
      totalPrepaid,
      totalInPerson,
      totalSignedUp,
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
