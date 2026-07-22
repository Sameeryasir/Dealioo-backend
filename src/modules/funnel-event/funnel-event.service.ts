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
  buildBusinessOrderPaymentSummary,
  customerCampaignVisitKey,
  type BusinessOrderPaymentStatus,
  type BusinessVisitSnapshot,
} from './business-order-payment.util';
import {
  matchesBusinessEventStatusFilter,
  matchesBusinessFunnelEventDateFilter,
  normalizeBusinessFunnelEventSearch,
  resolveBusinessEventDisplayStatus,
  dedupeBusinessOrderEventRows,
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

    const pendingDeals = await this.dataSource.transaction(async (manager) => {
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
      for (const funnel of funnelsForPurchase) {
        const amountCents = dollarsToCents(Number(funnel.campaign.price));
        const payment = manager.create(FunnelPayment, {
          funnelId: funnel.id,
          businessId,
          campaignId: funnel.campaign.id,
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

      return created;
    });

    if (pendingDeals == null && idempotencyKey) {
      const existing = await this.scannerPurchaseRequestRepository.findOne({
        where: { businessId, idempotencyKey },
      });
      return (existing?.responseJson as ScannerPurchasedDeal[]) ?? [];
    }

    const deals = pendingDeals ?? [];
    const purchased: ScannerPurchasedDeal[] = [];

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

        const existingVisit = await this.customerVisitRepository.findOne({
          where: { couponId: coupon.id },
        });
        if (!existingVisit) {
          await this.customerVisitRepository.save({
            customerId,
            campaignId: funnel.campaign.id,
            businessId,
            couponId: coupon.id,
            staffUserId,
            visitedAt: collectedAt,
            source: CustomerVisitSource.STAFF_LOOKUP,
            orderSubtotal: visitOrderSubtotalDollars,
          });

          await this.customerJourneyService.recordQrRedeemed({
            businessId,
            customerId,
            campaignId: funnel.campaign.id,
            funnelId,
            couponId: coupon.id,
            funnelPaymentId: coupon.funnelPaymentId ?? paymentId,
            occurredAt: collectedAt,
            source: 'scanner_purchase',
          });
        }

        purchased.push({
          funnelId,
          campaignName: funnel.campaign.campaignName,
          couponId: coupon.id,
        });
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

    const allEventsTotal = await this.funnelEventRepository
      .createQueryBuilder('event')
      .withDeleted()
      .innerJoin('event.funnel', 'funnel')
      .innerJoin('funnel.campaign', 'campaign')
      .where('campaign.restaurant_id = :businessId', { businessId })
      .andWhere('event.deleted_at IS NULL')
      .getCount();

    const eventQb = this.funnelEventRepository
      .createQueryBuilder('event')
      .withDeleted()
      .innerJoinAndSelect('event.funnel', 'funnel')
      .innerJoinAndSelect('funnel.campaign', 'campaign')
      .leftJoinAndSelect('event.customer', 'customer')
      .leftJoinAndSelect('event.funnelPayment', 'funnelPayment')
      .where('campaign.restaurant_id = :businessId', { businessId })
      .andWhere('event.deleted_at IS NULL');

    if (search) {
      const searchPattern = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
      eventQb.andWhere(
        `(
          COALESCE(customer.name, '') ILIKE :searchPattern
          OR COALESCE(event.customer_email, '') ILIKE :searchPattern
          OR COALESCE(customer.phone, '') ILIKE :searchPattern
          OR COALESCE(campaign.campaign_name, '') ILIKE :searchPattern
        )`,
        { searchPattern },
      );
    }

    const eventRows = (await eventQb.getMany()).filter(
      (row) => row.funnel?.campaign != null,
    );

    const linkedPaymentIds = new Set(
      eventRows
        .map((row) => row.funnelPaymentId)
        .filter((id): id is number => id != null),
    );

    const unlinkedPayments = await this.loadUnlinkedPayments(
      businessId,
      linkedPaymentIds,
      search,
    );

    const visitPairs = [
      ...eventRows
        .filter((row) => row.customerId != null && row.funnel?.campaign?.id != null)
        .map((row) => ({
          customerId: row.customerId!,
          campaignId: row.funnel.campaign.id,
        })),
      ...unlinkedPayments
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
        })),
    ];

    const paymentIdsForVisits = [
      ...new Set(
        [
          ...eventRows
            .map((row) => row.funnelPaymentId)
            .filter((id): id is number => id != null),
          ...unlinkedPayments.map((payment) => payment.id),
        ],
      ),
    ];

    const visitByPaymentId = await this.loadVisitsByFunnelPaymentId(
      businessId,
      paymentIdsForVisits,
    );
    const visitByCustomerCampaign = await this.loadLatestBusinessVisits(
      businessId,
      visitPairs,
    );

    const mappedRows = eventRows.map((row) =>
      this.mapFunnelEventToBusinessRow(
        row,
        visitByPaymentId,
        visitByCustomerCampaign,
      ),
    );
    const paymentOnlyRows = unlinkedPayments.map((payment) =>
      this.mapPaymentToBusinessRow(
        payment,
        visitByPaymentId,
        visitByCustomerCampaign,
      ),
    );

    const combinedRows = dedupeBusinessOrderEventRows([
      ...mappedRows,
      ...paymentOnlyRows,
    ]).filter((row) =>
      matchesBusinessFunnelEventDateFilter(
        {
          createdAt: row.createdAt,
          paidAt: row.paidAt,
          businessVisitedAt: row.businessVisitedAt,
        },
        dateFilter,
      ),
    );

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

  private mapFunnelEventToBusinessRow(
    row: FunnelEvent & {
      funnel: Funnel & { campaign: Campaign };
      customer?: Customer | null;
      funnelPayment?: FunnelPayment | null;
    },
    visitByPaymentId: Map<number, BusinessVisitSnapshot>,
    visitByCustomerCampaign: Map<string, BusinessVisitSnapshot>,
  ) {
    const visitFromPayment =
      row.funnelPaymentId != null
        ? (visitByPaymentId.get(row.funnelPaymentId) ?? null)
        : null;
    const visitKey =
      row.customerId != null
        ? customerCampaignVisitKey(row.customerId, row.funnel.campaign.id)
        : null;
    const visitFallback =
      visitKey != null ? (visitByCustomerCampaign.get(visitKey) ?? null) : null;
    const visit = visitFromPayment ?? visitFallback;
    const livePaymentStatus = row.funnelPayment?.status ?? null;
    const paidAt =
      livePaymentStatus === FunnelPaymentStatus.PAID
        ? (row.funnelPayment?.paidAt ??
            row.funnelPayment?.createdAt ??
            null)
        : null;
    const paymentSummary = buildBusinessOrderPaymentSummary(row, visitFromPayment, {
      paidAt,
      livePaymentStatus,
    });

    return {
      id: row.id,
      rowKey: `event:${row.id}`,
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
      paymentStatus: livePaymentStatus ?? row.paymentStatus,
      receiptUrl: row.receiptUrl,
      orderStatus: paymentSummary.orderStatus,
      onlineAmountCents: paymentSummary.onlineAmountCents,
      businessAmount: paymentSummary.businessAmount,
      businessVisitedAt: paymentSummary.businessVisitedAt,
      paidAt,
      funnelPaymentId: row.funnelPaymentId,
    };
  }

  private mapPaymentToBusinessRow(
    payment: FunnelPayment & {
      funnel?: (Funnel & { campaign?: Campaign | null }) | null;
      campaign?: Campaign | null;
      customerId: number | null;
      customer: Customer | null;
    },
    visitByPaymentId: Map<number, BusinessVisitSnapshot>,
    visitByCustomerCampaign: Map<string, BusinessVisitSnapshot>,
  ) {
    const funnelId = payment.funnelId ?? payment.funnel?.id ?? null;
    const campaign = payment.campaign ?? payment.funnel?.campaign ?? null;
    const campaignId = payment.campaignId ?? campaign?.id ?? null;
    const visitFromPayment = visitByPaymentId.get(payment.id) ?? null;
    const visitKey =
      payment.customerId != null && campaignId != null
        ? customerCampaignVisitKey(payment.customerId, campaignId)
        : null;
    const visitFallback =
      visitKey != null ? (visitByCustomerCampaign.get(visitKey) ?? null) : null;
    const visit = visitFromPayment ?? visitFallback;
    const sortAt =
      payment.paidAt ?? payment.updatedAt ?? payment.createdAt;
    const paymentSummary = buildBusinessOrderPaymentSummary(
      {
        eventType: FunnelEventType.PAYMENT,
        amount: payment.amount,
        paymentStatus: payment.status,
      },
      visitFromPayment,
      { paidAt: payment.paidAt ?? payment.createdAt },
    );

    return {
      id: payment.id,
      rowKey: `payment:${payment.id}`,
      eventType: FunnelEventType.PAYMENT,
      createdAt: sortAt,
      funnelId: funnelId ?? 0,
      campaignId: payment.campaignId ?? campaign?.id ?? 0,
      campaignName: campaign?.campaignName?.trim() || 'Deleted campaign',
      customer: payment.customer
        ? {
            id: payment.customer.id,
            name: payment.customer.name,
            email: payment.customer.email,
            phone: payment.customer.phone,
          }
        : null,
      customerEmail: payment.customerEmail,
      amount: payment.amount,
      currency: payment.currency,
      paymentStatus: payment.status,
      receiptUrl: payment.receiptUrl,
      orderStatus: paymentSummary.orderStatus,
      onlineAmountCents: paymentSummary.onlineAmountCents,
      businessAmount: paymentSummary.businessAmount,
      businessVisitedAt: paymentSummary.businessVisitedAt,
      paidAt: payment.paidAt ?? payment.createdAt,
      funnelPaymentId: payment.id,
    };
  }

  private async loadUnlinkedPayments(
    businessId: number,
    linkedPaymentIds: Set<number>,
    search?: string,
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
    const qb = this.funnelPaymentRepository
      .createQueryBuilder('payment')
      .withDeleted()
      .leftJoinAndSelect('payment.funnel', 'funnel')
      .where('payment.restaurant_id = :businessId', { businessId })
      .andWhere('payment.deleted_at IS NULL');

    if (linkedPaymentIds.size > 0) {
      qb.andWhere('payment.id NOT IN (:...linkedPaymentIds)', {
        linkedPaymentIds: [...linkedPaymentIds],
      });
    }

    const payments = await qb.getMany();
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
        [...customerIdByPaymentId.values()].filter(
          (id): id is number => id != null,
        ),
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

    const enriched = payments.map((payment) => {
      const customerId = customerIdByPaymentId.get(payment.id) ?? null;
      return {
        ...payment,
        funnel: payment.funnel ?? null,
        campaign:
          payment.campaignId != null
            ? (campaignById.get(payment.campaignId) ?? null)
            : null,
        customerId,
        customer: customerId != null ? (customerById.get(customerId) ?? null) : null,
      };
    });

    const searchPattern = search?.toLowerCase();
    if (!searchPattern) {
      return enriched;
    }

    return enriched.filter((payment) => {
      const haystack = [
        payment.customer?.name,
        payment.customer?.email,
        payment.customer?.phone,
        payment.customerEmail,
        payment.campaign?.campaignName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchPattern);
    });
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
    const campaignIds = [...new Set(pairs.map((pair) => pair.campaignId))];

    const visits = await this.customerVisitRepository.find({
      where: {
        businessId,
        customerId: In(customerIds),
        campaignId: In(campaignIds),
      },
      order: { visitedAt: 'DESC' },
    });

    for (const visit of visits) {
      const key = customerCampaignVisitKey(visit.customerId, visit.campaignId);
      if (result.has(key)) {
        continue;
      }

      result.set(key, {
        orderSubtotal:
          visit.orderSubtotal != null ? Number(visit.orderSubtotal) : null,
        visitedAt: visit.visitedAt,
      });
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
