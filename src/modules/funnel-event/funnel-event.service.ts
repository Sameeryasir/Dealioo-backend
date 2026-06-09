import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { CustomerVisit, CustomerVisitSource } from '../../db/entities/customer-visit.entity';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { AutomationService } from '../automation/automation.service';
import { ActivityService } from '../activity/activity.service';
import { CouponService } from '../redemption/coupon.service';
import { SignupQrEmailService } from '../redemption/signup-qr-email.service';
import { TrackFunnelEventDto } from './funnelEventDto/track-funnel-event.dto';
import {
  buildRecentMonthBuckets,
  type OverviewMonthBucket,
} from './overview-monthly.util';
import {
  buildRestaurantOrderPaymentSummary,
  customerFunnelVisitKey,
  type RestaurantOrderPaymentStatus,
  type RestaurantVisitSnapshot,
} from './restaurant-order-payment.util';
@Injectable()
export class FunnelEventService {
  constructor(
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerVisit)
    private readonly customerVisitRepository: Repository<CustomerVisit>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    private readonly automationService: AutomationService,
    private readonly couponService: CouponService,
    private readonly signupQrEmailService: SignupQrEmailService,
    private readonly activityService: ActivityService,
  ) {}

  async track(dto: TrackFunnelEventDto): Promise<FunnelEvent> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: dto.funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const tracked =
      dto.eventType === FunnelEventType.SIGNUP
        ? await this.trackSignup(dto)
        : await this.trackPayment(dto);

    if (
      dto.eventType === FunnelEventType.SIGNUP &&
      tracked.event.customerId
    ) {
      const issued = await this.couponService.issueFromSignup(
        dto.funnelId,
        tracked.event.customerId,
      );
      if (issued.created && issued.coupon) {
        await this.signupQrEmailService.scheduleSignupQrEmail({
          couponId: issued.coupon.id,
          funnelId: dto.funnelId,
          customerId: tracked.event.customerId,
        });
      }
    }

    if (
      dto.eventType === FunnelEventType.PAYMENT &&
      tracked.event.customerId &&
      this.isPaidFunnelEvent(tracked.event)
    ) {
      await this.signupQrEmailService.cancelScheduledSignupQrEmail(
        tracked.event.customerId,
        dto.funnelId,
      );
    }

    if (
      dto.eventType === FunnelEventType.PAYMENT &&
      tracked.event.customerId &&
      tracked.event.funnelPaymentId
    ) {
      await this.couponService.issueFromPayment(
        tracked.event.funnelPaymentId,
        dto.funnelId,
        tracked.event.customerId,
      );
    }

    if (tracked.shouldRunAutomation) {
      await this.automationService.handleEvent(tracked.event);
    }

    if (
      dto.eventType === FunnelEventType.PAYMENT &&
      tracked.event.customerId &&
      tracked.event.funnelPaymentId &&
      this.isPaidFunnelEvent(tracked.event)
    ) {
      await this.activityService.logPrepaidForOffer({
        paymentId: tracked.event.funnelPaymentId,
        customerId: tracked.event.customerId,
      });
    }

    return tracked.event;
  }

  /** Scanner walk-in: enroll guest in selected deals and record payment + visit. */
  async purchaseDealsAtScanner(params: {
    restaurantId: number;
    customerId: number;
    funnelIds: number[];
    orderSubtotal: number;
    staffUserId: number;
  }): Promise<
    Array<{ funnelId: number; campaignName: string; couponId: number }>
  > {
    const { restaurantId, customerId, funnelIds, orderSubtotal, staffUserId } =
      params;

    if (!Number.isFinite(orderSubtotal) || orderSubtotal <= 0) {
      throw new BadRequestException('Enter an amount greater than zero.');
    }

    const uniqueFunnelIds = [...new Set(funnelIds)].sort((a, b) => a - b);
    if (uniqueFunnelIds.length === 0) {
      throw new BadRequestException('Select at least one deal.');
    }

    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found.');
    }

    const amountCentsPerDeal = Math.round(
      (orderSubtotal / uniqueFunnelIds.length) * 100,
    );
    const purchased: Array<{
      funnelId: number;
      campaignName: string;
      couponId: number;
    }> = [];

    for (const funnelId of uniqueFunnelIds) {
      const funnel = await this.funnelRepository.findOne({
        where: { id: funnelId },
        relations: ['campaign'],
      });
      if (!funnel?.campaign || funnel.campaign.restaurantId !== restaurantId) {
        throw new NotFoundException(
          `Deal not found for this restaurant (funnel ${funnelId}).`,
        );
      }

      await this.track({
        eventType: FunnelEventType.SIGNUP,
        funnelId,
        customerId,
        visitorId: `scanner-${staffUserId}`,
      });

      const payment = this.funnelPaymentRepository.create({
        funnelId,
        restaurantId,
        campaignId: funnel.campaign.id,
        amount: amountCentsPerDeal,
        currency: 'usd',
        status: FunnelPaymentStatus.PAID,
        customerEmail: customer.email.trim(),
        platformFeeAmount: 0,
        refundedAmount: 0,
        stripePaymentIntentId: null,
        stripeConnectedAccountId: null,
      });
      const savedPayment = await this.funnelPaymentRepository.save(payment);

      await this.track({
        eventType: FunnelEventType.PAYMENT,
        funnelId,
        customerId,
        funnelPaymentId: savedPayment.id,
        amount: amountCentsPerDeal,
        currency: 'usd',
        paymentStatus: FunnelPaymentStatus.PAID,
        customerEmail: customer.email.trim(),
      });

      const coupon = await this.couponService.findByCustomerAndFunnel(
        customerId,
        funnelId,
      );
      if (!coupon) {
        throw new BadRequestException('Could not issue pass for this deal.');
      }

      const visitedAt = new Date();
      const existingVisit = await this.customerVisitRepository.findOne({
        where: { couponId: coupon.id },
      });
      if (!existingVisit) {
        await this.customerVisitRepository.save({
          customerId,
          campaignId: funnel.campaign.id,
          restaurantId,
          couponId: coupon.id,
          staffUserId,
          visitedAt,
          source: CustomerVisitSource.QR_REDEMPTION,
          orderSubtotal,
        });

        await this.activityService.logVisited({
          restaurantId,
          customerId,
          couponId: coupon.id,
          restaurantName: restaurant.name?.trim() || 'Restaurant',
          occurredAt: visitedAt,
        });
      }

      purchased.push({
        funnelId,
        campaignName: funnel.campaign.campaignName,
        couponId: coupon.id,
      });
    }

    return purchased;
  }

  async getStats(funnelId: number): Promise<{
    funnelId: number;
    signups: number;
    payments: number;
    signupOnly: number;
    paidAfterSignup: number;
    revenue: number;
    currency: string | null;
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const rows = await this.funnelEventRepository.find({
      where: { funnelId },
    });

    let signupOnly = 0;
    let paidAfterSignup = 0;

    for (const row of rows) {
      const signedUp = row.customerId !== null;
      const paid = row.funnelPaymentId !== null;

      if (!signedUp) {
        continue;
      }

      if (paid) {
        paidAfterSignup += 1;
      } else {
        signupOnly += 1;
      }
    }

    const paidPayments = await this.funnelPaymentRepository.find({
      where: { funnelId, status: FunnelPaymentStatus.PAID },
      select: ['amount', 'currency'],
    });

    let revenue = 0;
    let currency: string | null = null;

    for (const payment of paidPayments) {
      revenue += payment.amount;
      if (!currency && payment.currency) {
        currency = payment.currency;
      }
    }

    return {
      funnelId,
      signups: signupOnly + paidAfterSignup,
      payments: paidAfterSignup,
      signupOnly,
      paidAfterSignup,
      revenue,
      currency,
    };
  }

  async getStatsMonthly(
    funnelId: number,
    monthCount: number,
  ): Promise<{
    funnelId: number;
    months: number;
    currency: string | null;
    data: {
      month: string;
      signups: number;
      payments: number;
      signupOnly: number;
      paidAfterSignup: number;
      revenue: number;
    }[];
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const buckets = buildRecentMonthBuckets(monthCount);
    let currency: string | null = null;
    const data: {
      month: string;
      signups: number;
      payments: number;
      signupOnly: number;
      paidAfterSignup: number;
      revenue: number;
    }[] = [];

    for (const bucket of buckets) {
      const point = await this.aggregateStatsForMonth(funnelId, bucket);
      data.push(point);
      if (!currency && point.revenue > 0) {
        const sample = await this.funnelPaymentRepository.findOne({
          where: {
            funnelId,
            status: FunnelPaymentStatus.PAID,
            createdAt: And(
              MoreThanOrEqual(bucket.start),
              LessThan(bucket.end),
            ),
          },
          select: ['currency'],
        });
        currency = sample?.currency ?? null;
      }
    }

    if (!currency) {
      const anyPaid = await this.funnelPaymentRepository.findOne({
        where: { funnelId, status: FunnelPaymentStatus.PAID },
        select: ['currency'],
      });
      currency = anyPaid?.currency ?? null;
    }

    return { funnelId, months: monthCount, currency, data };
  }

  private async aggregateStatsForMonth(
    funnelId: number,
    bucket: OverviewMonthBucket,
  ): Promise<{
    month: string;
    signups: number;
    payments: number;
    signupOnly: number;
    paidAfterSignup: number;
    revenue: number;
  }> {
    const createdInMonth = And(
      MoreThanOrEqual(bucket.start),
      LessThan(bucket.end),
    );

    const rows = await this.funnelEventRepository.find({
      where: { funnelId, createdAt: createdInMonth },
    });

    let signupOnly = 0;
    let paidAfterSignup = 0;

    for (const row of rows) {
      if (row.customerId === null) {
        continue;
      }
      if (row.funnelPaymentId !== null) {
        paidAfterSignup += 1;
      } else {
        signupOnly += 1;
      }
    }

    const paidPayments = await this.funnelPaymentRepository.find({
      where: {
        funnelId,
        status: FunnelPaymentStatus.PAID,
        createdAt: createdInMonth,
      },
      select: ['amount'],
    });

    let revenue = 0;
    for (const payment of paidPayments) {
      revenue += payment.amount;
    }

    const payments = paidPayments.length;

    return {
      month: bucket.month,
      signups: signupOnly + paidAfterSignup,
      payments,
      signupOnly,
      paidAfterSignup,
      revenue,
    };
  }

  private async trackSignup(
    dto: TrackFunnelEventDto,
  ): Promise<{ event: FunnelEvent; shouldRunAutomation: boolean }> {
    if (!dto.customerId) {
      throw new BadRequestException('customerId is required for signup events');
    }

    const customerId = await this.resolveCustomerId(dto.customerId);
    if (customerId === null) {
      throw new NotFoundException('Customer not found.');
    }

    const visitorId = dto.visitorId?.trim() ?? null;
    const existing = await this.findRowByFunnelAndCustomer(
      dto.funnelId,
      customerId,
    );

    if (existing) {
      existing.eventType = FunnelEventType.SIGNUP;
      existing.customerId = customerId;
      if (visitorId) {
        existing.visitorId = visitorId;
      }
      return {
        event: await this.funnelEventRepository.save(existing),
        shouldRunAutomation: false,
      };
    }

    const event = this.funnelEventRepository.create({
      funnelId: dto.funnelId,
      eventType: FunnelEventType.SIGNUP,
      customerId,
      visitorId,
    });

    return {
      event: await this.funnelEventRepository.save(event),
      shouldRunAutomation: true,
    };
  }

  private async trackPayment(
    dto: TrackFunnelEventDto,
  ): Promise<{ event: FunnelEvent; shouldRunAutomation: boolean }> {
    let payment: FunnelPayment | null = null;

    if (dto.funnelPaymentId) {
      payment = await this.funnelPaymentRepository.findOne({
        where: { id: dto.funnelPaymentId, funnelId: dto.funnelId },
      });
      if (!payment) {
        throw new NotFoundException(
          'Funnel payment not found for this funnel',
        );
      }
    } else if (dto.stripePaymentIntentId) {
      payment = await this.funnelPaymentRepository.findOne({
        where: {
          stripePaymentIntentId: dto.stripePaymentIntentId,
          funnelId: dto.funnelId,
        },
      });
    }

    if (!dto.customerId) {
      throw new BadRequestException('customerId is required for payment events');
    }

    const customerId = await this.resolveCustomerId(dto.customerId);
    if (customerId === null) {
      throw new NotFoundException('Customer not found.');
    }

    const visitorId = dto.visitorId?.trim() ?? null;
    const existing = await this.findRowByFunnelAndCustomer(
      dto.funnelId,
      customerId,
    );

    const funnelPaymentId = payment?.id ?? dto.funnelPaymentId ?? null;

    if (existing) {
      const wasPaidBefore = this.isPaidFunnelEvent(existing);
      existing.customerId = customerId;
      if (visitorId) {
        existing.visitorId = visitorId;
      }
      this.applyPaymentFieldsToRow(existing, dto, payment);
      const event = await this.funnelEventRepository.save(existing);
      const isPaidNow = this.isPaidFunnelEvent(event);
      return {
        event,
        shouldRunAutomation: !wasPaidBefore && isPaidNow,
      };
    }

    const event = this.funnelEventRepository.create({
      funnelId: dto.funnelId,
      eventType: FunnelEventType.PAYMENT,
      customerId,
      visitorId,
      funnelPaymentId,
      amount: dto.amount ?? payment?.amount ?? null,
      currency: dto.currency ?? payment?.currency ?? null,
      paymentStatus: dto.paymentStatus ?? payment?.status ?? null,
      stripePaymentIntentId:
        dto.stripePaymentIntentId ?? payment?.stripePaymentIntentId ?? null,
      customerEmail: dto.customerEmail ?? payment?.customerEmail ?? null,
      receiptUrl: dto.receiptUrl ?? payment?.receiptUrl ?? null,
    });

    const saved = await this.funnelEventRepository.save(event);
    return {
      event: saved,
      shouldRunAutomation: this.isPaidFunnelEvent(saved),
    };
  }

  private isPaidFunnelEvent(event: FunnelEvent): boolean {
    if (event.paymentStatus === FunnelPaymentStatus.PAID) {
      return true;
    }
    return event.funnelPaymentId !== null && event.funnelPaymentId !== undefined;
  }

  private applyPaymentFieldsToRow(
    row: FunnelEvent,
    dto: TrackFunnelEventDto,
    payment: FunnelPayment | null,
  ): void {
    row.eventType = FunnelEventType.PAYMENT;
    row.funnelPaymentId = payment?.id ?? dto.funnelPaymentId ?? row.funnelPaymentId;
    row.amount = dto.amount ?? payment?.amount ?? row.amount;
    row.currency = dto.currency ?? payment?.currency ?? row.currency;
    row.paymentStatus = dto.paymentStatus ?? payment?.status ?? row.paymentStatus;
    row.stripePaymentIntentId =
      dto.stripePaymentIntentId ??
      payment?.stripePaymentIntentId ??
      row.stripePaymentIntentId;
    row.customerEmail =
      dto.customerEmail ?? payment?.customerEmail ?? row.customerEmail;
    row.receiptUrl = dto.receiptUrl ?? payment?.receiptUrl ?? row.receiptUrl;
  }

  private async findRowByFunnelAndCustomer(
    funnelId: number,
    customerId: number,
  ): Promise<FunnelEvent | null> {
    return this.funnelEventRepository.findOne({
      where: { funnelId, customerId },
    });
  }

  private async resolveCustomerId(
    customerId: number,
  ): Promise<number | null> {
    const exists = await this.customerRepository.exist({
      where: { id: customerId },
    });
    return exists ? customerId : null;
  }

  async getRestaurantFunnelEvents(
    restaurantId: number,
    page?: number,
    limit?: number,
  ): Promise<{
    data: Array<{
      id: number;
      eventType: FunnelEventType;
      createdAt: Date;
      funnelId: number;
      campaignId: number;
      campaignName: string;
      customer: {
        id: number;
        name: string;
        email: string;
        phone: string | null;
      } | null;
      customerEmail: string | null;
      amount: number | null;
      currency: string | null;
      paymentStatus: FunnelPaymentStatus | null;
      receiptUrl: string | null;
      orderStatus: RestaurantOrderPaymentStatus;
      onlineAmountCents: number | null;
      restaurantAmount: number | null;
      restaurantVisitedAt: Date | null;
    }>;
    meta: PaginationMeta & {
      campaignCount: number;
      funnelCount: number;
    };
  }> {
    const pagination = normalizePagination(page, limit);

    const campaignCount = await this.campaignRepository.count({
      where: { restaurantId },
    });

    const funnelCount = await this.funnelRepository
      .createQueryBuilder('funnel')
      .innerJoin('funnel.campaign', 'campaign')
      .where('campaign.restaurant_id = :restaurantId', { restaurantId })
      .getCount();

    const [rows, total] = await this.funnelEventRepository.findAndCount({
      where: {
        funnel: {
          campaign: {
            restaurantId,
          },
        },
      },
      relations: {
        customer: true,
        funnel: {
          campaign: true,
        },
      },
      order: { createdAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    const filteredRows = rows.filter((row) => row.funnel?.campaign != null);

    const visitByCustomerFunnel = await this.loadLatestRestaurantVisits(
      restaurantId,
      filteredRows
        .filter((row) => row.customerId != null)
        .map((row) => ({
          customerId: row.customerId!,
          funnelId: row.funnelId,
        })),
    );

    return {
      data: filteredRows.map((row) => {
        const visitKey =
          row.customerId != null
            ? customerFunnelVisitKey(row.customerId, row.funnelId)
            : null;
        const visit =
          visitKey != null ? (visitByCustomerFunnel.get(visitKey) ?? null) : null;
        const paymentSummary = buildRestaurantOrderPaymentSummary(row, visit);

        return {
          id: row.id,
          eventType: row.eventType,
          createdAt: row.createdAt,
          funnelId: row.funnelId,
          campaignId: row.funnel.campaign.id,
          campaignName: row.funnel.campaign.campaignName,
          customer: row.customer
            ? {
                id: row.customer.id,
                name: row.customer.name,
                email: row.customer.email,
                phone: row.customer.phone,
              }
            : null,
          customerEmail: row.customerEmail,
          amount: row.amount,
          currency: row.currency,
          paymentStatus: row.paymentStatus,
          receiptUrl: row.receiptUrl,
          orderStatus: paymentSummary.orderStatus,
          onlineAmountCents: paymentSummary.onlineAmountCents,
          restaurantAmount: paymentSummary.restaurantAmount,
          restaurantVisitedAt: paymentSummary.restaurantVisitedAt,
        };
      }),
      meta: {
        ...buildPaginationMeta(total, pagination.page, pagination.limit),
        campaignCount,
        funnelCount,
      },
    };
  }

  /** Latest scanner visit amounts keyed by customer + funnel (one batch query per page). */
  private async loadLatestRestaurantVisits(
    restaurantId: number,
    pairs: Array<{ customerId: number; funnelId: number }>,
  ): Promise<Map<string, RestaurantVisitSnapshot>> {
    const result = new Map<string, RestaurantVisitSnapshot>();
    if (pairs.length === 0) {
      return result;
    }

    const customerIds = [...new Set(pairs.map((pair) => pair.customerId))];
    const funnelIds = [...new Set(pairs.map((pair) => pair.funnelId))];

    const visits = await this.customerVisitRepository.find({
      where: {
        restaurantId,
        coupon: {
          customerId: In(customerIds),
          funnelId: In(funnelIds),
        },
      },
      relations: { coupon: true },
      order: { visitedAt: 'DESC' },
    });

    for (const visit of visits) {
      const customerId = visit.coupon?.customerId;
      const funnelId = visit.coupon?.funnelId;
      if (customerId == null || funnelId == null) {
        continue;
      }
      if (visit.orderSubtotal == null) {
        continue;
      }

      const key = customerFunnelVisitKey(customerId, funnelId);
      if (result.has(key)) {
        continue;
      }

      result.set(key, {
        orderSubtotal: Number(visit.orderSubtotal),
        visitedAt: visit.visitedAt,
      });
    }

    return result;
  }

}
