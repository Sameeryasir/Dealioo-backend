import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  EntityManager,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
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
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { CreateActivityEventDto } from './activityDto/create-activity-event.dto';
import { LogPrepaidForOfferDto } from './activityDto/log-prepaid-for-offer.dto';
import { LogRedeemedRewardDto } from './activityDto/log-redeemed-reward.dto';
import { LogVisitedDto } from './activityDto/log-visited.dto';

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
};

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
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
  ) {}

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
        restaurantId: params.restaurantId,
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
      restaurantId: params.restaurantId,
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
      restaurantId: params.restaurantId,
      customerId: params.customerId,
      eventType: ActivityEventType.VISITED,
      description: `Scanned at ${params.restaurantName}`,
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
      relations: ['restaurant'],
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

    const restaurantName =
      payment.restaurant?.name?.trim() || 'Unknown location';
    const amountLabel = formatMoney(payment.amount, payment.currency);

    const payload: CreateActivityEventDto = {
      restaurantId: payment.restaurantId,
      customerId,
      eventType: ActivityEventType.PREPAID_FOR_OFFER,
      description: `${amountLabel} at ${restaurantName}`,
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

  async getRestaurantEvents(
    restaurantId: number,
    options: {
      page?: number;
      limit?: number;
      eventType?: ActivityEventType | null;
      from?: Date | null;
      to?: Date | null;
    },
  ): Promise<{ data: ActivityEventListItem[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const pagination = normalizePagination(options.page, options.limit);

    const where: FindOptionsWhere<ActivityEvent> = {
      restaurantId,
    };

    if (options.eventType) {
      where.eventType = options.eventType;
    }

    if (options.from && options.to) {
      where.occurredAt = And(
        MoreThanOrEqual(options.from),
        LessThanOrEqual(options.to),
      );
    } else if (options.from) {
      where.occurredAt = MoreThanOrEqual(options.from);
    } else if (options.to) {
      where.occurredAt = LessThanOrEqual(options.to);
    }

    const [rows, total] = await this.activityRepository.findAndCount({
      where,
      relations: { customer: true },
      order: { occurredAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      data: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        occurredAt: row.occurredAt.toISOString(),
        customerName: row.customer?.name?.trim() || null,
        customerEmail: row.customer?.email?.trim() || null,
        description: row.description,
      })),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async getRestaurantSummary(
    restaurantId: number,
    options: { from?: Date | null; to?: Date | null },
  ): Promise<ActivitySummary> {
    const qb = this.activityRepository
      .createQueryBuilder('activity')
      .select('activity.eventType', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .where('activity.restaurantId = :restaurantId', { restaurantId })
      .groupBy('activity.eventType');

    if (options.from) {
      qb.andWhere('activity.occurredAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('activity.occurredAt <= :to', { to: options.to });
    }

    const rows = await qb.getRawMany<{ eventType: ActivityEventType; count: string }>();

    let totalVisited = 0;
    let totalRedeemed = 0;
    let totalPrepaid = 0;

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
        default:
          break;
      }
    }

    return {
      totalEvents: totalVisited + totalRedeemed + totalPrepaid,
      totalVisited,
      totalRedeemed,
      totalPrepaid,
    };
  }
}
