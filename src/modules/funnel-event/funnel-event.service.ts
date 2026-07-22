import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { And, DataSource, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { CustomerVisit, CustomerVisitSource } from '../../db/entities/customer-visit.entity';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import {
  centsToDollars,
  dollarsEqualInCents,
  dollarsToCents,
} from '../../common/money.util';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import {
  FunnelCollectionChannel,
  FunnelPayment,
  FunnelPaymentMethod,
  FunnelPaymentSource,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import {
  Order,
  OrderSource,
  OrderStatus,
} from '../../db/entities/order.entity';
import { ScannerPurchaseRequest } from '../../db/entities/scanner-purchase-request.entity';
import { Business } from '../../db/entities/business.entity';
import { AutomationService } from '../automation/automation.service';
import { ActivityService } from '../activity/activity.service';
import { CustomerJourneyService } from '../customer-journey/customer-journey.service';
import { CouponService } from '../redemption/coupon.service';
import {
  ScannerErrorCode,
  ScannerErrorMessage,
} from '../redemption/scanner-error-codes';
import { SignupQrEmailService } from '../redemption/signup-qr-email.service';
import { TrackFunnelEventDto } from './funnelEventDto/track-funnel-event.dto';
import {
  buildRecentMonthBuckets,
} from './overview-monthly.util';
import {
  customerCampaignVisitKey,
  type BusinessOrderPaymentStatus,
  type BusinessVisitSnapshot,
} from './business-order-payment.util';
import {
  matchesBusinessEventStatusFilter,
  matchesBusinessFunnelEventDateFilter,
  normalizeBusinessFunnelEventSearch,
  resolveBusinessEventDisplayStatus,
  sortBusinessFunnelEventsByPaymentDate,
} from './business-funnel-events-filters.util';
import {
  GetBusinessFunnelEventsQueryDto,
  type BusinessFunnelEventDateFilter,
  type BusinessFunnelEventStatusFilter,
} from './funnelEventDto/get-business-funnel-events-query.dto';

type ScannerPurchasedDeal = {
  funnelId: number;
  campaignName: string;
  couponId: number;
};
@Injectable()
export class FunnelEventService {
  private readonly logger = new Logger(FunnelEventService.name);

  constructor(
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerVisit)
    private readonly customerVisitRepository: Repository<CustomerVisit>,
    @InjectRepository(CheckoutAccessToken)
    private readonly checkoutAccessTokenRepository: Repository<CheckoutAccessToken>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(ScannerPurchaseRequest)
    private readonly scannerPurchaseRequestRepository: Repository<ScannerPurchaseRequest>,
    private readonly dataSource: DataSource,
    private readonly automationService: AutomationService,
    private readonly couponService: CouponService,
    private readonly signupQrEmailService: SignupQrEmailService,
    private readonly activityService: ActivityService,
    private readonly customerJourneyService: CustomerJourneyService,
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
      tracked.event.funnelPaymentId
    ) {
      await this.couponService.issueFromPayment(
        tracked.event.funnelPaymentId,
        dto.funnelId,
        tracked.event.customerId,
      );
    }

    if (
      dto.eventType === FunnelEventType.PAYMENT &&
      tracked.event.customerId &&
      this.isPaidFunnelEvent(tracked.event)
    ) {
      const skipBuiltinPaymentPassEmail =
        await this.automationService.isBuiltinPaymentPassEmailSuperseded(
          dto.funnelId,
        );
      await this.signupQrEmailService.sendSignupPassEmailOnPayment(
        tracked.event.customerId,
        dto.funnelId,
        tracked.event.funnelPaymentId ?? undefined,
        { skipDelivery: skipBuiltinPaymentPassEmail },
      );
    }

    if (tracked.shouldRunAutomation) {
      if (
        dto.eventType === FunnelEventType.PAYMENT &&
        this.isPaidFunnelEvent(tracked.event)
      ) {
        this.logger.log(
          `[Prepaid Offer] Triggering automation from payment track — paymentId=${tracked.event.funnelPaymentId ?? 'none'} customerId=${tracked.event.customerId} funnelId=${dto.funnelId}`,
        );
      }
      await this.automationService.handleEvent(tracked.event);
    } else if (
      dto.eventType === FunnelEventType.PAYMENT &&
      tracked.event.customerId &&
      this.isPaidFunnelEvent(tracked.event)
    ) {
      this.logger.log(
        `[Prepaid Offer] Ensuring prepaid start for existing paid payment — paymentId=${tracked.event.funnelPaymentId ?? 'none'} customerId=${tracked.event.customerId} funnelId=${dto.funnelId}`,
      );
      await this.automationService.handleEvent(tracked.event, {
        skipCancelPendingOnPayment: true,
        onlyIfNoExecutionForPayment: true,
      });
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

    await this.recordJourneyFromTrackedEvent(funnel, tracked.event);

    return tracked.event;
  }


  async syncPaidFunnelPaymentAutomation(
    funnelPaymentId: number,
  ): Promise<void> {
    this.logger.log(
      `[Prepaid Offer] Syncing automation for paid payment ${funnelPaymentId}`,
    );

    const payment = await this.funnelPaymentRepository.findOne({
      where: { id: funnelPaymentId },
    });
    if (!payment || payment.status !== FunnelPaymentStatus.PAID) {
      this.logger.warn(
        `[Prepaid Offer] Sync skipped — payment ${funnelPaymentId} is missing or not paid`,
      );
      return;
    }

    const customerId = await this.resolveCustomerIdForPayment(payment);
    if (!customerId) {
      this.logger.warn(
        `[Prepaid Offer] Sync skipped — could not resolve customer for payment ${funnelPaymentId}`,
      );
      return;
    }

    this.logger.log(
      `[Prepaid Offer] Tracking paid payment ${funnelPaymentId} for customer ${customerId} on funnel ${payment.funnelId}`,
    );

    await this.track({
      eventType: FunnelEventType.PAYMENT,
      funnelId: payment.funnelId,
      funnelPaymentId: payment.id,
      customerId,
      paymentStatus: FunnelPaymentStatus.PAID,
      amount: payment.amount,
      currency: payment.currency,
      customerEmail: payment.customerEmail,
      stripePaymentIntentId: payment.stripePaymentIntentId ?? undefined,
      receiptUrl: payment.receiptUrl ?? undefined,
    });
  }

  async purchaseDealsAtScanner(params: {
    businessId: number;
    customerId: number;
    funnelIds: number[];
    orderSubtotal?: number;
    extraItemsAmount?: number;
    staffUserId: number;
    idempotencyKey?: string;
  }): Promise<ScannerPurchasedDeal[]> {
    const { businessId, customerId, staffUserId } = params;
    const uniqueFunnelIds = [...new Set(params.funnelIds)].sort((a, b) => a - b);
    if (uniqueFunnelIds.length === 0) {
      throw new BadRequestException('Select at least one deal.');
    }

    const extraItemsCents =
      params.extraItemsAmount != null &&
      Number.isFinite(params.extraItemsAmount) &&
      params.extraItemsAmount > 0
        ? dollarsToCents(params.extraItemsAmount)
        : 0;
    if (extraItemsCents < 0) {
      throw new BadRequestException({
        code: ScannerErrorCode.INVALID_AMOUNT,
        message: ScannerErrorMessage.INVALID_AMOUNT,
      });
    }

    const idempotencyKey = params.idempotencyKey?.trim() || null;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          customerId,
          funnelIds: uniqueFunnelIds,
          extraItemsCents,
        }),
      )
      .digest('hex');

    if (idempotencyKey) {
      const existing = await this.scannerPurchaseRequestRepository.findOne({
        where: { businessId, idempotencyKey },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException({
            code: ScannerErrorCode.DUPLICATE_PURCHASE,
            message: ScannerErrorMessage.DUPLICATE_PURCHASE,
          });
        }
        return existing.responseJson as ScannerPurchasedDeal[];
      }
    }

    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    const funnelsForPurchase: Array<Funnel & { campaign: Campaign }> = [];
    let expectedTotalCents = 0;

    for (const funnelId of uniqueFunnelIds) {
      const funnel = await this.funnelRepository.findOne({
        where: { id: funnelId },
        relations: ['campaign'],
      });
      if (!funnel?.campaign || funnel.campaign.businessId !== businessId) {
        throw new NotFoundException(
          `Deal not found for this business (funnel ${funnelId}).`,
        );
      }
      if (funnel.campaign.deletedAt) {
        throw new BadRequestException({
          code: ScannerErrorCode.CAMPAIGN_INACTIVE,
          message: ScannerErrorMessage.CAMPAIGN_INACTIVE,
        });
      }

      const campaignPrice =
        funnel.campaign.price != null ? Number(funnel.campaign.price) : null;
      if (
        campaignPrice == null ||
        !Number.isFinite(campaignPrice) ||
        campaignPrice < 0
      ) {
        throw new BadRequestException({
          code: ScannerErrorCode.INVALID_AMOUNT,
          message: ScannerErrorMessage.INVALID_AMOUNT,
        });
      }

      expectedTotalCents += dollarsToCents(campaignPrice);
      funnelsForPurchase.push(funnel as Funnel & { campaign: Campaign });
    }

    const expectedTotalDollars = centsToDollars(expectedTotalCents);
    if (expectedTotalCents <= 0) {
      throw new BadRequestException({
        code: ScannerErrorCode.INVALID_AMOUNT,
        message: ScannerErrorMessage.INVALID_AMOUNT,
      });
    }

    if (
      params.orderSubtotal != null &&
      Number.isFinite(params.orderSubtotal) &&
      !dollarsEqualInCents(params.orderSubtotal, expectedTotalDollars)
    ) {
      throw new BadRequestException({
        code: ScannerErrorCode.INVALID_AMOUNT,
        message: ScannerErrorMessage.INVALID_AMOUNT,
      });
    }

    const visitOrderSubtotalDollars = centsToDollars(
      expectedTotalCents + extraItemsCents,
    );
    const collectedAt = new Date();

    type PendingDeal = {
      funnel: Funnel & { campaign: Campaign };
      paymentId: number;
      amountCents: number;
    };

    const purchaseBatch = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
        businessId,
        customerId,
      ]);

      if (idempotencyKey) {
        const raced = await manager.findOne(ScannerPurchaseRequest, {
          where: { businessId, idempotencyKey },
          lock: { mode: 'pessimistic_write' },
        });
        if (raced) {
          if (raced.requestHash !== requestHash) {
            throw new ConflictException({
              code: ScannerErrorCode.DUPLICATE_PURCHASE,
              message: ScannerErrorMessage.DUPLICATE_PURCHASE,
            });
          }
          return null;
        }
      }

      const created: PendingDeal[] = [];
      const order = await manager.save(
        manager.create(Order, {
          businessId,
          customerId,
          status: OrderStatus.PAID,
          source: OrderSource.SCANNER,
          totalAmount: expectedTotalCents,
          currency: 'usd',
          paidAt: collectedAt,
          collectedByUserId: staffUserId,
        }),
      );

      for (const funnel of funnelsForPurchase) {
        const amountCents = dollarsToCents(Number(funnel.campaign.price));
        const payment = manager.create(FunnelPayment, {
          funnelId: funnel.id,
          businessId,
          campaignId: funnel.campaign.id,
          customerId,
          orderId: order.id,
          amount: amountCents,
          currency: 'usd',
          status: FunnelPaymentStatus.PAID,
          customerEmail: customer.email.trim(),
          platformFeeAmount: 0,
          refundedAmount: 0,
          stripePaymentIntentId: null,
          stripeConnectedAccountId: null,
          paymentSource: FunnelPaymentSource.SCANNER,
          collectionChannel: FunnelCollectionChannel.IN_STORE,
          paymentMethod: FunnelPaymentMethod.OTHER,
          paymentCollectedBy: staffUserId,
          paymentCollectedAt: collectedAt,
          paidAt: collectedAt,
        });
        const savedPayment = await manager.save(payment);
        created.push({
          funnel,
          paymentId: savedPayment.id,
          amountCents,
        });
      }

      if (idempotencyKey) {
        await manager.save(
          manager.create(ScannerPurchaseRequest, {
            businessId,
            customerId,
            staffUserId,
            idempotencyKey,
            requestHash,
            responseJson: [],
          }),
        );
      }

      return { orderId: order.id, deals: created };
    });

    if (purchaseBatch == null && idempotencyKey) {
      const existing = await this.scannerPurchaseRequestRepository.findOne({
        where: { businessId, idempotencyKey },
      });
      return (existing?.responseJson as ScannerPurchasedDeal[]) ?? [];
    }

    const deals = purchaseBatch?.deals ?? [];
    const orderId = purchaseBatch?.orderId ?? null;
    const purchased: ScannerPurchasedDeal[] = [];
    const issuedCoupons: Array<{
      couponId: number;
      campaignId: number;
      funnelId: number;
      paymentId: number;
      funnelPaymentId: number | null;
    }> = [];

    try {
      for (const deal of deals) {
        const { funnel, paymentId, amountCents } = deal;
        const funnelId = funnel.id;

        await this.track({
          eventType: FunnelEventType.SIGNUP,
          funnelId,
          customerId,
          visitorId: `scanner-${staffUserId}`,
        });

        await this.track({
          eventType: FunnelEventType.PAYMENT,
          funnelId,
          customerId,
          funnelPaymentId: paymentId,
          amount: amountCents,
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

        issuedCoupons.push({
          couponId: coupon.id,
          campaignId: funnel.campaign.id,
          funnelId,
          paymentId,
          funnelPaymentId: coupon.funnelPaymentId ?? paymentId,
        });

        purchased.push({
          funnelId,
          campaignName: funnel.campaign.campaignName,
          couponId: coupon.id,
        });
      }

      if (issuedCoupons.length > 0) {
        const campaignIds = [
          ...new Set(issuedCoupons.map((row) => row.campaignId)),
        ];
        const primary = issuedCoupons[0]!;
        const existingVisit = await this.customerVisitRepository.findOne({
          where: { couponId: primary.couponId },
        });
        if (!existingVisit) {
          await this.customerVisitRepository.save({
            customerId,
            campaignId: primary.campaignId,
            businessId,
            couponId: primary.couponId,
            orderId,
            staffUserId,
            visitedAt: collectedAt,
            source: CustomerVisitSource.STAFF_LOOKUP,
            orderSubtotal: visitOrderSubtotalDollars,
            visitCampaigns: campaignIds.map((campaignId) => ({
              campaignId,
            })),
          });
        }
      }

      if (idempotencyKey) {
        await this.scannerPurchaseRequestRepository.update(
          { businessId, idempotencyKey },
          { responseJson: purchased },
        );
      }

      return purchased;
    } catch (err) {
      this.logger.error(
        `Scanner purchase side-effects failed after payments committed (business=${businessId} customer=${customerId})`,
        err instanceof Error ? err.stack : err,
      );
      throw err;
    }
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
      select: ['id'],
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const buckets = buildRecentMonthBuckets(monthCount);
    if (buckets.length === 0) {
      return { funnelId, months: monthCount, currency: null, data: [] };
    }

    const rangeStart = buckets[0]!.start;

    const [eventRows, paymentRows, currencyRow] = await Promise.all([
      this.funnelEventRepository
        .createQueryBuilder('e')
        .select(
          `TO_CHAR(DATE_TRUNC('month', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM')`,
          'month',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE e.customer_id IS NOT NULL AND e.funnel_payment_id IS NULL)`,
          'signupOnly',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE e.customer_id IS NOT NULL AND e.funnel_payment_id IS NOT NULL)`,
          'paidAfterSignup',
        )
        .where('e.funnel_id = :funnelId', { funnelId })
        .andWhere('e.created_at >= :rangeStart', { rangeStart })
        .groupBy(`DATE_TRUNC('month', e.created_at AT TIME ZONE 'UTC')`)
        .getRawMany<{
          month: string;
          signupOnly: string;
          paidAfterSignup: string;
        }>(),
      this.funnelPaymentRepository
        .createQueryBuilder('p')
        .select(
          `TO_CHAR(DATE_TRUNC('month', COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'UTC'), 'YYYY-MM')`,
          'month',
        )
        .addSelect('COUNT(*)', 'payments')
        .addSelect('COALESCE(SUM(p.amount), 0)', 'revenue')
        .where('p.funnel_id = :funnelId', { funnelId })
        .andWhere('p.status = :paid', { paid: FunnelPaymentStatus.PAID })
        .andWhere(
          'COALESCE(p.paid_at, p.created_at) >= :rangeStart',
          { rangeStart },
        )
        .groupBy(
          `DATE_TRUNC('month', COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'UTC')`,
        )
        .getRawMany<{
          month: string;
          payments: string;
          revenue: string;
        }>(),
      this.funnelPaymentRepository.findOne({
        where: { funnelId, status: FunnelPaymentStatus.PAID },
        select: ['currency'],
      }),
    ]);

    const eventsByMonth = new Map(eventRows.map((row) => [row.month, row]));
    const paymentsByMonth = new Map(paymentRows.map((row) => [row.month, row]));

    const data = buckets.map((bucket) => {
      const eventRow = eventsByMonth.get(bucket.month);
      const paymentRow = paymentsByMonth.get(bucket.month);
      const signupOnly = Number(eventRow?.signupOnly ?? 0);
      const paidAfterSignup = Number(eventRow?.paidAfterSignup ?? 0);

      return {
        month: bucket.month,
        signups: signupOnly + paidAfterSignup,
        payments: Number(paymentRow?.payments ?? 0),
        signupOnly,
        paidAfterSignup,
        revenue: Number(paymentRow?.revenue ?? 0),
      };
    });

    return {
      funnelId,
      months: monthCount,
      currency: currencyRow?.currency ?? null,
      data,
    };
  }

  private async recordJourneyFromTrackedEvent(
    funnel: Funnel,
    event: FunnelEvent,
  ): Promise<void> {
    if (event.customerId == null) {
      return;
    }

    const campaign =
      funnel.campaign ??
      (await this.campaignRepository.findOne({
        where: { id: funnel.campaignId },
      }));
    if (!campaign) {
      return;
    }

    if (
      event.eventType === FunnelEventType.SIGNUP ||
      event.customerId != null
    ) {
      await this.customerJourneyService.recordSignup({
        businessId: campaign.businessId,
        customerId: event.customerId,
        campaignId: campaign.id,
        funnelId: funnel.id,
        occurredAt: event.createdAt,
        source: 'funnel_track',
        funnelEventId: event.id,
      });
    }

    if (
      event.eventType === FunnelEventType.PAYMENT &&
      this.isPaidFunnelEvent(event) &&
      event.funnelPaymentId != null
    ) {
      await this.customerJourneyService.recordPayment({
        businessId: campaign.businessId,
        customerId: event.customerId,
        campaignId: campaign.id,
        funnelId: funnel.id,
        funnelPaymentId: event.funnelPaymentId,
        occurredAt: event.createdAt,
        source: 'funnel_track',
      });
    }
  }

  async getCustomerJourneyForBusiness(params: {
    businessId: number;
    customerId: number;
    campaignId: number;
    funnelId?: number | null;
    funnelPaymentId?: number | null;
  }) {
    return this.customerJourneyService.getJourney(params);
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
      if (payment) {
        const resolvedCustomerId =
          await this.resolveCustomerIdForPayment(payment);
        if (resolvedCustomerId) {
          dto.customerId = resolvedCustomerId;
        }
      }
    }

    if (!dto.customerId) {
      throw new BadRequestException('customerId is required for payment events');
    }

    const customerId = await this.resolveCustomerId(dto.customerId);
    if (customerId === null) {
      throw new NotFoundException('Customer not found.');
    }

    const visitorId = dto.visitorId?.trim() ?? null;
    const funnelPaymentId = payment?.id ?? dto.funnelPaymentId ?? null;
    const stripePaymentIntentId =
      dto.stripePaymentIntentId ?? payment?.stripePaymentIntentId ?? null;
    // Never trust client "paid" unless funnel_payment is actually PAID.
    const paymentStatus = this.resolveTrackedPaymentStatus(dto, payment);

    let existing = await this.findPaymentEventRow(
      dto.funnelId,
      customerId,
      funnelPaymentId,
      stripePaymentIntentId,
    );

    if (existing) {
      const wasPaidBefore = this.isPaidFunnelEvent(existing);
      existing.customerId = customerId;
      if (visitorId) {
        existing.visitorId = visitorId;
      }
      this.applyPaymentFieldsToRow(existing, dto, payment, paymentStatus);
      const savedExisting = await this.funnelEventRepository.save(existing);
      const event = Array.isArray(savedExisting)
        ? savedExisting[0]!
        : savedExisting;
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
      paymentStatus,
      stripePaymentIntentId:
        dto.stripePaymentIntentId ?? payment?.stripePaymentIntentId ?? null,
      customerEmail: dto.customerEmail ?? payment?.customerEmail ?? null,
      receiptUrl: dto.receiptUrl ?? payment?.receiptUrl ?? null,
    });

    const saved = await this.funnelEventRepository.save(event);
    const savedEvent = Array.isArray(saved) ? saved[0]! : saved;
    return {
      event: savedEvent,
      shouldRunAutomation: this.isPaidFunnelEvent(savedEvent),
    };
  }

  private resolveTrackedPaymentStatus(
    dto: TrackFunnelEventDto,
    payment: FunnelPayment | null,
  ): FunnelPaymentStatus | null {
    if (payment) {
      return payment.status;
    }
    if (dto.paymentStatus === FunnelPaymentStatus.PAID) {
      return FunnelPaymentStatus.PENDING;
    }
    if (
      dto.paymentStatus &&
      Object.values(FunnelPaymentStatus).includes(
        dto.paymentStatus as FunnelPaymentStatus,
      )
    ) {
      return dto.paymentStatus as FunnelPaymentStatus;
    }
    return null;
  }

  private isPaidFunnelEvent(event: FunnelEvent): boolean {
    return event.paymentStatus === FunnelPaymentStatus.PAID;
  }

  private async findPaymentEventRow(
    funnelId: number,
    customerId: number,
    funnelPaymentId: number | null,
    stripePaymentIntentId: string | null,
  ): Promise<FunnelEvent | null> {
    if (funnelPaymentId != null) {
      const byPayment = await this.funnelEventRepository.findOne({
        where: { funnelPaymentId },
      });
      if (byPayment) {
        return byPayment;
      }
    }

    const piId = stripePaymentIntentId?.trim();
    if (piId) {
      const byIntent = await this.funnelEventRepository.findOne({
        where: { funnelId, stripePaymentIntentId: piId },
      });
      if (byIntent) {
        return byIntent;
      }
    }

    const journeyRow = await this.findRowByFunnelAndCustomer(funnelId, customerId);
    if (!journeyRow) {
      return null;
    }

    if (
      journeyRow.funnelPaymentId != null &&
      funnelPaymentId != null &&
      journeyRow.funnelPaymentId !== funnelPaymentId
    ) {
      return null;
    }

    return journeyRow;
  }

  private applyPaymentFieldsToRow(
    row: FunnelEvent,
    dto: TrackFunnelEventDto,
    payment: FunnelPayment | null,
    resolvedPaymentStatus?: FunnelPaymentStatus | null,
  ): void {
    row.eventType = FunnelEventType.PAYMENT;
    row.funnelPaymentId = payment?.id ?? dto.funnelPaymentId ?? row.funnelPaymentId;
    row.amount = dto.amount ?? payment?.amount ?? row.amount;
    row.currency = dto.currency ?? payment?.currency ?? row.currency;
    row.paymentStatus =
      resolvedPaymentStatus ??
      payment?.status ??
      (dto.paymentStatus === FunnelPaymentStatus.PAID
        ? FunnelPaymentStatus.PENDING
        : row.paymentStatus);
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

  private async resolveCustomerIdForPayment(
    payment: FunnelPayment,
  ): Promise<number | null> {
    const checkoutToken = await this.checkoutAccessTokenRepository.findOne({
      where: { funnelPaymentId: payment.id },
      order: { createdAt: 'DESC' },
    });
    if (checkoutToken?.customerId) {
      return checkoutToken.customerId;
    }

    const email = payment.customerEmail?.trim();
    if (email) {
      const tokenForFunnel = await this.checkoutAccessTokenRepository
        .createQueryBuilder('token')
        .innerJoin('token.customer', 'customer')
        .where('token.funnel_id = :funnelId', { funnelId: payment.funnelId })
        .andWhere('LOWER(customer.email) = LOWER(:email)', { email })
        .orderBy('token.created_at', 'DESC')
        .addOrderBy('token.id', 'DESC')
        .getOne();
      if (tokenForFunnel?.customerId) {
        return tokenForFunnel.customerId;
      }
    }

    const coupon = await this.couponService.findByPaymentId(payment.id);
    if (coupon?.customerId) {
      return coupon.customerId;
    }

    if (email) {
      const customer = await this.customerRepository
        .createQueryBuilder('customer')
        .where('LOWER(customer.email) = LOWER(:email)', { email })
        .orderBy('customer.id', 'DESC')
        .getOne();
      if (customer) {
        return customer.id;
      }
    }

    if (email) {
      const funnelEvent = await this.funnelEventRepository
        .createQueryBuilder('event')
        .innerJoin('event.customer', 'customer')
        .where('event.funnel_id = :funnelId', { funnelId: payment.funnelId })
        .andWhere('LOWER(customer.email) = LOWER(:email)', { email })
        .andWhere('event.customer_id IS NOT NULL')
        .orderBy('event.created_at', 'DESC')
        .addOrderBy('event.id', 'DESC')
        .getOne();
      if (funnelEvent?.customerId) {
        const resolved = await this.resolveCustomerId(funnelEvent.customerId);
        if (resolved) {
          return resolved;
        }
      }
    }

    return null;
  }

  async getBusinessFunnelEvents(
    businessId: number,
    page?: number,
    limit?: number,
    filters: GetBusinessFunnelEventsQueryDto = {},
  ): Promise<{
    data: Array<{
      id: number;
      rowKey: string;
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
      orderStatus: BusinessOrderPaymentStatus;
      onlineAmountCents: number | null;
      businessAmount: number | null;
      businessVisitedAt: Date | null;
      paidAt: Date | null;
      funnelPaymentId: number | null;
      paymentCollectedAt: Date | null;
      orderId: number | null;
      paymentSource: string | null;
    }>;
    meta: PaginationMeta & {
      campaignCount: number;
      funnelCount: number;
      allEventsTotal: number;
    };
  }> {
    const pagination = normalizePagination(page, limit);
    const statusFilter: BusinessFunnelEventStatusFilter = filters.status ?? 'all';
    const dateFilter: BusinessFunnelEventDateFilter = filters.date ?? 'all';
    const search = normalizeBusinessFunnelEventSearch(filters.search);

    const campaignCount = await this.campaignRepository.count({
      where: { businessId },
    });

    const funnelCount = await this.funnelRepository
      .createQueryBuilder('funnel')
      .innerJoin('funnel.campaign', 'campaign')
      .where('campaign.restaurant_id = :businessId', { businessId })
      .getCount();

    // allEventsTotal still counts funnel_event rows for dashboard meta.
    const allEventsTotal = await this.funnelEventRepository
      .createQueryBuilder('event')
      .withDeleted()
      .innerJoin('event.funnel', 'funnel')
      .innerJoin('funnel.campaign', 'campaign')
      .where('campaign.restaurant_id = :businessId', { businessId })
      .andWhere('event.deleted_at IS NULL')
      .getCount();

    const orders = await this.loadBusinessOrders(businessId);
    const orderIds = orders.map((order) => order.id);
    const paymentsByOrderId = await this.loadPaymentsGroupedByOrderId(
      businessId,
      orderIds,
    );

    const allPaymentsForVisits = [...paymentsByOrderId.values()].flat();

    const visitPairs = allPaymentsForVisits
      .filter((payment) => {
        const campaignId =
          payment.campaignId ??
          payment.campaign?.id ??
          payment.funnel?.campaign?.id ??
          null;
        return payment.customerId != null && campaignId != null;
      })
      .map((payment) => ({
        customerId: payment.customerId!,
        campaignId:
          payment.campaignId ??
          payment.campaign?.id ??
          payment.funnel!.campaign!.id,
      }));

    const paymentIdsForVisits = [
      ...new Set(allPaymentsForVisits.map((payment) => payment.id)),
    ];

    const visitByPaymentId = await this.loadVisitsByFunnelPaymentId(
      businessId,
      paymentIdsForVisits,
    );
    const visitByCustomerCampaign = await this.loadLatestBusinessVisits(
      businessId,
      visitPairs,
    );
    const visitByOrderId = await this.loadVisitsByOrderId(businessId, orderIds);

    const combinedRows = orders
      .map((order) =>
        this.mapOrderToBusinessRow(
          order,
          paymentsByOrderId.get(order.id) ?? [],
          visitByPaymentId,
          visitByCustomerCampaign,
          visitByOrderId.get(order.id) ?? null,
        ),
      )
      .filter((row) => {
      if (
        !matchesBusinessFunnelEventDateFilter(
          {
            createdAt: row.createdAt,
            paidAt: row.paidAt,
            businessVisitedAt: row.businessVisitedAt,
          },
          dateFilter,
        )
      ) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = [
        row.customer?.name,
        row.customer?.email,
        row.customer?.phone,
        row.customerEmail,
        row.campaignName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search.toLowerCase());
    });

    const statusFilteredRows =
      statusFilter === 'all'
        ? combinedRows
        : combinedRows.filter((row) =>
            matchesBusinessEventStatusFilter(
              resolveBusinessEventDisplayStatus(row),
              statusFilter,
            ),
          );

    const sortedRows = sortBusinessFunnelEventsByPaymentDate(statusFilteredRows);
    const total = sortedRows.length;
    const data = sortedRows.slice(
      pagination.skip,
      pagination.skip + pagination.limit,
    );

    return {
      data,
      meta: {
        ...buildPaginationMeta(total, pagination.page, pagination.limit),
        campaignCount,
        funnelCount,
        allEventsTotal,
      },
    };
  }

  private async loadBusinessOrders(
    businessId: number,
  ): Promise<Array<Order & { customer: Customer | null }>> {
    return this.orderRepository
      .createQueryBuilder('ord')
      .leftJoinAndSelect('ord.customer', 'customer')
      .where('ord.restaurant_id = :businessId', { businessId })
      .andWhere('ord.deleted_at IS NULL')
      .getMany() as Promise<Array<Order & { customer: Customer | null }>>;
  }

  private async loadPaymentsGroupedByOrderId(
    businessId: number,
    orderIds: number[],
  ): Promise<
    Map<
      number,
      Array<
        FunnelPayment & {
          funnel: (Funnel & { campaign?: Campaign | null }) | null;
          campaign: Campaign | null;
          customerId: number | null;
          customer: Customer | null;
        }
      >
    >
  > {
    const grouped = new Map<
      number,
      Array<
        FunnelPayment & {
          funnel: (Funnel & { campaign?: Campaign | null }) | null;
          campaign: Campaign | null;
          customerId: number | null;
          customer: Customer | null;
        }
      >
    >();

    if (orderIds.length === 0) {
      return grouped;
    }

    const payments = await this.enrichPaymentsForBusinessOrders(
      await this.funnelPaymentRepository
        .createQueryBuilder('payment')
        .withDeleted()
        .leftJoinAndSelect('payment.funnel', 'funnel')
        .where('payment.restaurant_id = :businessId', { businessId })
        .andWhere('payment.deleted_at IS NULL')
        .andWhere('payment.order_id IN (:...orderIds)', { orderIds })
        .getMany(),
    );

    for (const payment of payments) {
      if (payment.orderId == null) {
        continue;
      }
      const existing = grouped.get(payment.orderId) ?? [];
      existing.push(payment);
      grouped.set(payment.orderId, existing);
    }

    return grouped;
  }

  private async enrichPaymentsForBusinessOrders(
    payments: FunnelPayment[],
  ): Promise<
    Array<
      FunnelPayment & {
        funnel: (Funnel & { campaign?: Campaign | null }) | null;
        campaign: Campaign | null;
        customerId: number | null;
        customer: Customer | null;
      }
    >
  > {
    if (payments.length === 0) {
      return [];
    }

    const campaignIds = [
      ...new Set(
        payments
          .map((payment) => payment.campaignId)
          .filter((id): id is number => id != null && id > 0),
      ),
    ];
    const campaigns =
      campaignIds.length > 0
        ? await this.campaignRepository.find({
            where: { id: In(campaignIds) },
            withDeleted: true,
          })
        : [];
    const campaignById = new Map(
      campaigns.map((campaign) => [campaign.id, campaign]),
    );

    const customerIdByPaymentId =
      await this.resolveCustomerIdsForPayments(payments);
    const customerIds = [
      ...new Set(
        [
          ...payments
            .map((payment) => payment.customerId)
            .filter((id): id is number => id != null),
          ...customerIdByPaymentId.values(),
        ].filter((id): id is number => id != null),
      ),
    ];
    const customers =
      customerIds.length > 0
        ? await this.customerRepository.find({
            where: { id: In(customerIds) },
            withDeleted: true,
          })
        : [];
    const customerById = new Map(
      customers.map((customer) => [customer.id, customer]),
    );

    return payments.map((payment) => {
      const customerId =
        payment.customerId ?? customerIdByPaymentId.get(payment.id) ?? null;
      return {
        ...payment,
        funnel: payment.funnel ?? null,
        campaign:
          payment.campaignId != null
            ? (campaignById.get(payment.campaignId) ?? null)
            : null,
        customerId,
        customer:
          customerId != null ? (customerById.get(customerId) ?? null) : null,
      };
    });
  }

  private mapOrderToBusinessRow(
    order: Order & { customer: Customer | null },
    payments: Array<
      FunnelPayment & {
        funnel: (Funnel & { campaign?: Campaign | null }) | null;
        campaign: Campaign | null;
        customerId: number | null;
        customer: Customer | null;
      }
    >,
    visitByPaymentId: Map<number, BusinessVisitSnapshot>,
    visitByCustomerCampaign: Map<string, BusinessVisitSnapshot>,
    visitForOrder: BusinessVisitSnapshot | null,
  ) {
    const sortedPayments = [...payments].sort((left, right) => {
      const leftAt = new Date(left.paidAt ?? left.createdAt).getTime();
      const rightAt = new Date(right.paidAt ?? right.createdAt).getTime();
      return rightAt - leftAt;
    });
    const primary = sortedPayments[0] ?? null;

    const campaignNames: string[] = [];
    const seenCampaignNames = new Set<string>();
    let totalVisitNetDollars = 0;
    let receiptUrl: string | null = null;
    let paymentCollectedAt: Date | null = order.paidAt;
    let anyPaid = order.status === OrderStatus.PAID;
    const seenVisitIds = new Set<number>();

    if (
      visitForOrder?.orderSubtotal != null &&
      Number(visitForOrder.orderSubtotal) > 0
    ) {
      totalVisitNetDollars = Number(visitForOrder.orderSubtotal);
      if (visitForOrder.visitId != null) {
        seenVisitIds.add(visitForOrder.visitId);
      }
    }

    for (const payment of sortedPayments) {
      const campaign =
        payment.campaign ?? payment.funnel?.campaign ?? null;
      const campaignName = campaign?.campaignName?.trim();
      if (campaignName && !seenCampaignNames.has(campaignName.toLowerCase())) {
        seenCampaignNames.add(campaignName.toLowerCase());
        campaignNames.push(campaignName);
      }

      if (totalVisitNetDollars <= 0) {
        const visitFromPayment = visitByPaymentId.get(payment.id) ?? null;
        const campaignId = payment.campaignId ?? campaign?.id ?? null;
        const visitKey =
          payment.customerId != null && campaignId != null
            ? customerCampaignVisitKey(payment.customerId, campaignId)
            : null;
        const visitFallback =
          visitKey != null
            ? (visitByCustomerCampaign.get(visitKey) ?? null)
            : null;
        const visit = visitFromPayment ?? visitFallback;
        if (
          visit?.orderSubtotal != null &&
          Number(visit.orderSubtotal) > 0 &&
          (visit.visitId == null || !seenVisitIds.has(visit.visitId))
        ) {
          if (visit.visitId != null) {
            seenVisitIds.add(visit.visitId);
          }
          totalVisitNetDollars += Number(visit.orderSubtotal);
        }
      }

      if (!receiptUrl && payment.receiptUrl) {
        receiptUrl = payment.receiptUrl;
      }
      if (payment.paymentCollectedAt) {
        paymentCollectedAt = payment.paymentCollectedAt;
      }
      if (payment.status === FunnelPaymentStatus.PAID) {
        anyPaid = true;
      }
    }

    const customer =
      order.customer ??
      primary?.customer ??
      null;
    const paidAt = order.paidAt ?? primary?.paidAt ?? order.createdAt;
    const onlineAmountCents =
      order.totalAmount > 0
        ? order.totalAmount
        : sortedPayments.reduce(
            (sum, payment) =>
              payment.status === FunnelPaymentStatus.PAID
                ? sum + (payment.amount ?? 0)
                : sum,
            0,
          );
    const hasOnline = anyPaid && onlineAmountCents > 0;
    const hasBusiness = totalVisitNetDollars > 0;
    let orderStatus: BusinessOrderPaymentStatus = 'not_paid';
    if (hasOnline && hasBusiness) {
      orderStatus = 'paid_both';
    } else if (hasOnline) {
      orderStatus = 'paid_online';
    } else if (hasBusiness) {
      orderStatus = 'paid_walk_in';
    }

    return {
      id: order.id,
      rowKey: `order:${order.id}`,
      eventType: FunnelEventType.PAYMENT,
      createdAt: paidAt ?? order.createdAt,
      funnelId: primary?.funnelId ?? primary?.funnel?.id ?? 0,
      campaignId:
        primary?.campaignId ??
        primary?.campaign?.id ??
        primary?.funnel?.campaign?.id ??
        0,
      campaignName:
        campaignNames.join(', ') ||
        primary?.campaign?.campaignName?.trim() ||
        'Order',
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
          }
        : null,
      customerEmail:
        customer?.email ?? primary?.customerEmail ?? null,
      amount: onlineAmountCents > 0 ? onlineAmountCents : null,
      currency: order.currency || primary?.currency || 'usd',
      paymentStatus: anyPaid
        ? FunnelPaymentStatus.PAID
        : (primary?.status ?? null),
      receiptUrl,
      orderStatus,
      onlineAmountCents: hasOnline ? onlineAmountCents : null,
      businessAmount: hasBusiness
        ? Math.round(totalVisitNetDollars * 100) / 100
        : null,
      businessVisitedAt: hasBusiness
        ? (visitForOrder?.visitedAt ??
            sortedPayments
              .map((payment) => visitByPaymentId.get(payment.id)?.visitedAt)
              .find((value) => value != null) ??
            null)
        : null,
      paidAt: anyPaid ? paidAt : null,
      funnelPaymentId: primary?.id ?? null,
      paymentCollectedAt,
      orderId: order.id,
      paymentSource: primary?.paymentSource ?? null,
    };
  }

  private async resolveCustomerIdsForPayments(
    payments: FunnelPayment[],
  ): Promise<Map<number, number | null>> {
    const result = new Map<number, number | null>();
    if (payments.length === 0) {
      return result;
    }

    const paymentIds = payments.map((payment) => payment.id);

    const tokens = await this.checkoutAccessTokenRepository.find({
      where: { funnelPaymentId: In(paymentIds) },
      select: ['funnelPaymentId', 'customerId', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    const customerIdFromToken = new Map<number, number>();
    for (const token of tokens) {
      if (
        token.funnelPaymentId != null &&
        token.customerId != null &&
        !customerIdFromToken.has(token.funnelPaymentId)
      ) {
        customerIdFromToken.set(token.funnelPaymentId, token.customerId);
      }
    }

    const couponRows: Array<{ funnelPaymentId: number; customerId: number }> =
      await this.funnelEventRepository.manager.query(
        `
          SELECT DISTINCT ON (funnel_payment_id)
            funnel_payment_id AS "funnelPaymentId",
            customer_id AS "customerId"
          FROM coupons
          WHERE funnel_payment_id = ANY($1)
            AND customer_id IS NOT NULL
            AND deleted_at IS NULL
          ORDER BY funnel_payment_id, id DESC
        `,
        [paymentIds],
      );
    const customerIdFromCoupon = new Map(
      couponRows.map((row) => [Number(row.funnelPaymentId), Number(row.customerId)]),
    );

    const unresolvedEmails = [
      ...new Set(
        payments
          .filter(
            (payment) =>
              !customerIdFromToken.has(payment.id) &&
              !customerIdFromCoupon.has(payment.id) &&
              Boolean(payment.customerEmail?.trim()),
          )
          .map((payment) => payment.customerEmail!.trim().toLowerCase()),
      ),
    ];

    const customersByEmail = new Map<string, number>();
    if (unresolvedEmails.length > 0) {
      const emailCustomers = await this.customerRepository
        .createQueryBuilder('customer')
        .where('LOWER(customer.email) IN (:...emails)', {
          emails: unresolvedEmails,
        })
        .orderBy('customer.id', 'DESC')
        .getMany();
      for (const customer of emailCustomers) {
        const key = customer.email.trim().toLowerCase();
        if (!customersByEmail.has(key)) {
          customersByEmail.set(key, customer.id);
        }
      }
    }

    for (const payment of payments) {
      const fromToken = customerIdFromToken.get(payment.id);
      if (fromToken != null) {
        result.set(payment.id, fromToken);
        continue;
      }
      const fromCoupon = customerIdFromCoupon.get(payment.id);
      if (fromCoupon != null) {
        result.set(payment.id, fromCoupon);
        continue;
      }
      const email = payment.customerEmail?.trim().toLowerCase();
      result.set(payment.id, email ? (customersByEmail.get(email) ?? null) : null);
    }

    return result;
  }

  private async loadVisitsByOrderId(
    businessId: number,
    orderIds: number[],
  ): Promise<Map<number, BusinessVisitSnapshot>> {
    const result = new Map<number, BusinessVisitSnapshot>();
    if (orderIds.length === 0) {
      return result;
    }

    const visits = await this.customerVisitRepository.find({
      where: {
        businessId,
        orderId: In(orderIds),
      },
      order: { visitedAt: 'DESC' },
    });

    for (const visit of visits) {
      if (visit.orderId == null || result.has(visit.orderId)) {
        continue;
      }
      result.set(visit.orderId, {
        visitId: visit.id,
        orderSubtotal:
          visit.orderSubtotal != null ? Number(visit.orderSubtotal) : null,
        visitedAt: visit.visitedAt,
      });
    }

    return result;
  }

  private async loadVisitsByFunnelPaymentId(
    businessId: number,
    paymentIds: number[],
  ): Promise<Map<number, BusinessVisitSnapshot>> {
    const result = new Map<number, BusinessVisitSnapshot>();
    if (paymentIds.length === 0) {
      return result;
    }

    const visits = await this.customerVisitRepository
      .createQueryBuilder('visit')
      .innerJoinAndSelect('visit.coupon', 'coupon')
      .where('visit.businessId = :businessId', { businessId })
      .andWhere('coupon.funnelPaymentId IN (:...paymentIds)', { paymentIds })
      .andWhere('visit.deletedAt IS NULL')
      .orderBy('visit.visitedAt', 'DESC')
      .getMany();

    for (const visit of visits) {
      const paymentId = visit.coupon?.funnelPaymentId;
      if (paymentId == null || result.has(paymentId)) {
        continue;
      }
      result.set(paymentId, {
        visitId: visit.id,
        orderSubtotal:
          visit.orderSubtotal != null ? Number(visit.orderSubtotal) : null,
        visitedAt: visit.visitedAt,
      });
    }

    return result;
  }

  private async loadLatestBusinessVisits(
    businessId: number,
    pairs: Array<{ customerId: number; campaignId: number }>,
  ): Promise<Map<string, BusinessVisitSnapshot>> {
    const result = new Map<string, BusinessVisitSnapshot>();
    if (pairs.length === 0) {
      return result;
    }

    const customerIds = [...new Set(pairs.map((pair) => pair.customerId))];
    const campaignIdSet = new Set(pairs.map((pair) => pair.campaignId));

    const visits = await this.customerVisitRepository.find({
      where: {
        businessId,
        customerId: In(customerIds),
      },
      relations: { visitCampaigns: true },
      order: { visitedAt: 'DESC' },
    });

    for (const visit of visits) {
      const ids = [
        visit.campaignId,
        ...(visit.visitCampaigns ?? []).map((row) => row.campaignId),
      ];
      for (const campaignId of ids) {
        if (!campaignIdSet.has(campaignId)) {
          continue;
        }
        const key = customerCampaignVisitKey(visit.customerId, campaignId);
        if (result.has(key)) {
          continue;
        }
        result.set(key, {
          visitId: visit.id,
          orderSubtotal:
            visit.orderSubtotal != null ? Number(visit.orderSubtotal) : null,
          visitedAt: visit.visitedAt,
        });
      }
    }

    return result;
  }

  /** Distinct customers who signed up on this funnel (first signup time = joined). */
  async getFunnelGuests(
    funnelId: number,
    page?: number,
    limit?: number,
  ): Promise<{
    data: Array<{
      id: number;
      name: string;
      email: string;
      phone: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    meta: PaginationMeta;
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const pagination = normalizePagination(page, limit);

    const countRow = await this.funnelEventRepository
      .createQueryBuilder('event')
      .select('COUNT(DISTINCT event.customer_id)', 'total')
      .where('event.funnel_id = :funnelId', { funnelId })
      .andWhere('event.customer_id IS NOT NULL')
      .getRawOne<{ total: string }>();

    const total = Number(countRow?.total ?? 0);

    if (total === 0) {
      return {
        data: [],
        meta: buildPaginationMeta(0, pagination.page, pagination.limit),
      };
    }

    const rows = await this.funnelEventRepository
      .createQueryBuilder('event')
      .innerJoin('event.customer', 'customer')
      .select('customer.id', 'id')
      .addSelect('customer.name', 'name')
      .addSelect('customer.email', 'email')
      .addSelect('customer.phone', 'phone')
      .addSelect('customer.updated_at', 'updatedAt')
      .addSelect('MIN(event.created_at)', 'createdAt')
      .where('event.funnel_id = :funnelId', { funnelId })
      .andWhere('event.customer_id IS NOT NULL')
      .groupBy('customer.id')
      .addGroupBy('customer.name')
      .addGroupBy('customer.email')
      .addGroupBy('customer.phone')
      .addGroupBy('customer.updated_at')
      .orderBy('MIN(event.created_at)', 'DESC')
      .offset(pagination.skip)
      .limit(pagination.limit)
      .getRawMany<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        updatedAt: Date;
        createdAt: Date;
      }>();

    return {
      data: rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        email: row.email,
        phone: row.phone,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      })),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

}
