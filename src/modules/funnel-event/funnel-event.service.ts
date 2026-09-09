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
import { Campaign, CampaignType } from '../../db/entities/campaign.entity';
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
  DASHBOARD_CACHE_TTL_MS,
  dashboardTtlCache,
} from '../../common/ttl-cache';
import {
  ExtraItemsMismatchError,
  extraItemsFingerprint,
  extraItemsForApi,
  resolveCounterExtras,
  visitAddOnAmountDollars,
} from '../../utils/normalize-extra-items';
import {
  replaceVisitAddonItems,
  resolveVisitStoredExtraItems,
} from '../../utils/visit-addon-items.util';
import {
  VisitAddonItemSource,
} from '../../db/entities/visit-addon-item.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import {
  FunnelAnalyticsEvent,
  FunnelAnalyticsEventType,
} from '../../db/entities/funnel-analytics-event.entity';
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
import { BusinessHistoryService } from '../business-history/business-history.service';
import { CustomerActivityService } from '../customer-activity/customer-activity.service';
import { CustomerJourneyService } from '../customer-journey/customer-journey.service';
import { CustomerService } from '../customer/customer.service';
import { PendingFunnelPaymentService } from '../payment/pending-funnel-payment.service';
import { CouponService } from '../redemption/coupon.service';
import {
  Coupon,
  CouponPaymentStatus,
  CouponStatus,
} from '../../db/entities/coupon.entity';
import {
  ScannerErrorCode,
  ScannerErrorMessage,
} from '../redemption/scanner-error-codes';
import { SignupQrEmailService } from '../redemption/signup-qr-email.service';
import { TrackFunnelEventDto } from './funnelEventDto/track-funnel-event.dto';
import {
  buildRecentMonthBuckets,
} from './overview-monthly.util';
import { isOnlineFunnelPayment } from '../../common/payment-provenance.util';
import {
  customerCampaignVisitKey,
  isCounterExtrasOnlyScannerPayment,
  type BusinessOrderPaymentStatus,
  type BusinessVisitSnapshot,
} from './business-order-payment.util';
import {
  getBusinessFunnelEventDateFrom,
  normalizeBusinessFunnelEventSearch,
} from './business-funnel-events-filters.util';
import {
  GetBusinessFunnelEventsQueryDto,
  type BusinessFunnelEventDateFilter,
  type BusinessFunnelEventStatusFilter,
} from './funnelEventDto/get-business-funnel-events-query.dto';
import {
  ScannerPurchaseMeans,
} from './funnelEventDto/scanner-purchase-deals.dto';
import {
  applyPerformanceCampaignEarningsFilters,
  resolvePerformancePreviousWindow,
} from './business-performance.util';

// --- Scanner purchase response ---
// purchaseMeans echoes what the caller sent (IN_PERSON | REDEEMED | SCANNED).
type ScannerPurchasedDeal = {
  funnelId: number;
  campaignName: string;
  couponId: number | null;
  purchaseMeans: ScannerPurchaseMeans;
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
    private readonly customerActivityService: CustomerActivityService,
    private readonly customerJourneyService: CustomerJourneyService,
    private readonly customerService: CustomerService,
    private readonly businessHistoryService: BusinessHistoryService,
    private readonly pendingFunnelPaymentService: PendingFunnelPaymentService,
  ) {}

  async track(
    dto: TrackFunnelEventDto,
    options?: { skipPendingOrder?: boolean },
  ): Promise<FunnelEvent> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: dto.funnelId },
      relations: ['campaign'],
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
      const businessId = funnel.campaign?.businessId;
      if (businessId != null && businessId > 0) {
        await this.customerService.ensureBusinessCustomerLink(
          businessId,
          tracked.event.customerId,
        );
      }

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

      if (businessId != null && businessId > 0) {
        try {
          await this.activityService.logSignedUp({
            businessId,
            customerId: tracked.event.customerId,
            funnelId: dto.funnelId,
            campaignId: funnel.campaign?.id ?? null,
            campaignName: funnel.campaign?.campaignName ?? null,
            campaignType: funnel.campaign?.campaignType ?? null,
            occurredAt: new Date(),
          });
        } catch (activityError) {
          this.logger.warn(
            `Signup activity_event log failed funnel=${dto.funnelId} customer=${tracked.event.customerId}: ${
              activityError instanceof Error
                ? activityError.message
                : String(activityError)
            }`,
          );
        }
      }

      if (
        !options?.skipPendingOrder &&
        businessId != null &&
        businessId > 0 &&
        funnel.campaign
      ) {
        const customer = await this.customerRepository.findOne({
          where: { id: tracked.event.customerId },
        });
        const email = customer?.email?.trim().toLowerCase();
        if (email) {
          const priceDollars = Number(funnel.campaign.price);
          const amountCents =
            Number.isFinite(priceDollars) && priceDollars >= 0
              ? dollarsToCents(priceDollars)
              : 0;
          // --- Pending order for unpaid / postpaid signup ---
          // Link the signup coupon so Guest deals can show this pass (not only Business deals).
          // Platform/medium must match campaign type (postpaid ≠ Stripe).
          const pendingPayment =
            await this.pendingFunnelPaymentService.ensurePendingPayment({
              funnelId: dto.funnelId,
              businessId,
              campaignId: funnel.campaign.id,
              campaignType: funnel.campaign.campaignType,
              customerId: tracked.event.customerId,
              customerEmail: email,
              amountCents,
              currency: 'usd',
            });
          if (pendingPayment.id > 0) {
            await this.couponService.linkSignupCouponToPayment(
              tracked.event.customerId,
              dto.funnelId,
              pendingPayment.id,
            );
          }
        }
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
      tracked.event.funnelPaymentId &&
      this.isPaidFunnelEvent(tracked.event)
    ) {
      const skipBuiltinPaymentPassEmail =
        await this.automationService.isBuiltinPaymentPassEmailSuperseded(
          dto.funnelId,
        );
      await this.signupQrEmailService.sendSignupPassEmailOnPayment(
        tracked.event.customerId,
        dto.funnelId,
        tracked.event.funnelPaymentId,
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
      await this.automationService.enqueueHandleEvent(tracked.event);
    } else if (
      dto.eventType === FunnelEventType.PAYMENT &&
      tracked.event.customerId &&
      this.isPaidFunnelEvent(tracked.event)
    ) {
      this.logger.log(
        `[Prepaid Offer] Ensuring prepaid start for existing paid payment — paymentId=${tracked.event.funnelPaymentId ?? 'none'} customerId=${tracked.event.customerId} funnelId=${dto.funnelId}`,
      );
      await this.automationService.enqueueHandleEvent(tracked.event, {
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
      try {
        await this.activityService.logPrepaidForOffer({
          paymentId: tracked.event.funnelPaymentId,
          customerId: tracked.event.customerId,
        });
      } catch (activityError) {
        this.logger.warn(
          `Payment activity_event log failed payment=${tracked.event.funnelPaymentId}: ${
            activityError instanceof Error
              ? activityError.message
              : String(activityError)
          }`,
        );
      }
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
    purchaseMeans: ScannerPurchaseMeans;
    orderSubtotal?: number;
    extraItemsAmount?: number;
    extraItemNames?: string[];
    extraItems?: Array<{ name: string; unitPrice: number; qty: number }>;
    staffUserId: number;
    idempotencyKey?: string;
  }): Promise<ScannerPurchasedDeal[]> {
    const { businessId, customerId, staffUserId } = params;
    const purchaseMeans = params.purchaseMeans;
    if (
      purchaseMeans !== ScannerPurchaseMeans.IN_PERSON &&
      purchaseMeans !== ScannerPurchaseMeans.REDEEMED &&
      purchaseMeans !== ScannerPurchaseMeans.SCANNED
    ) {
      throw new BadRequestException(
        'purchaseMeans must be IN_PERSON, REDEEMED, or SCANNED.',
      );
    }

    const uniqueFunnelIds = [...new Set(params.funnelIds)].sort((a, b) => a - b);
    if (uniqueFunnelIds.length === 0) {
      throw new BadRequestException('Select at least one deal.');
    }

    let resolvedExtras;
    try {
      resolvedExtras = resolveCounterExtras({
        amountDollars: params.extraItemsAmount,
        items: params.extraItems,
        names: params.extraItemNames,
      });
    } catch (error) {
      if (error instanceof ExtraItemsMismatchError) {
        throw new BadRequestException({
          code: ScannerErrorCode.INVALID_AMOUNT,
          message: error.message,
        });
      }
      throw error;
    }
    const extraItemsCents = resolvedExtras.cents;
    const normalizedExtraItems = resolvedExtras.items;
    const normalizedExtraItemNames = resolvedExtras.labels;
    if (extraItemsCents < 0) {
      throw new BadRequestException({
        code: ScannerErrorCode.INVALID_AMOUNT,
        message: ScannerErrorMessage.INVALID_AMOUNT,
      });
    }

    const idempotencyKey = params.idempotencyKey?.trim() || null;
    // Include purchaseMeans + extras fingerprint so replay with different lines is a different request.
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          customerId,
          funnelIds: uniqueFunnelIds,
          extraItemsCents,
          extraItemsFingerprint: extraItemsFingerprint(normalizedExtraItems),
          purchaseMeans,
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
    let postpaidWithoutPriceCount = 0;

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

      const isPostpaid = funnel.campaign.campaignType === CampaignType.POSTPAID;
      const campaignPrice =
        funnel.campaign.price != null ? Number(funnel.campaign.price) : null;
      const hasCampaignPrice =
        campaignPrice != null &&
        Number.isFinite(campaignPrice) &&
        campaignPrice > 0;

      if (!hasCampaignPrice) {
        if (!isPostpaid) {
          throw new BadRequestException({
            code: ScannerErrorCode.INVALID_AMOUNT,
            message: ScannerErrorMessage.INVALID_AMOUNT,
          });
        }
        postpaidWithoutPriceCount += 1;
      } else {
        expectedTotalCents += dollarsToCents(campaignPrice);
      }

      funnelsForPurchase.push(funnel as Funnel & { campaign: Campaign });
    }

    const usesStaffEnteredOfferAmount =
      postpaidWithoutPriceCount > 0 &&
      postpaidWithoutPriceCount === funnelsForPurchase.length;

    if (postpaidWithoutPriceCount > 0 && !usesStaffEnteredOfferAmount) {
      throw new BadRequestException({
        code: ScannerErrorCode.INVALID_AMOUNT,
        message: ScannerErrorMessage.INVALID_AMOUNT,
      });
    }

    if (usesStaffEnteredOfferAmount) {
      if (
        params.orderSubtotal == null ||
        !Number.isFinite(params.orderSubtotal) ||
        params.orderSubtotal <= 0
      ) {
        throw new BadRequestException({
          code: ScannerErrorCode.INVALID_AMOUNT,
          message: ScannerErrorMessage.INVALID_AMOUNT,
        });
      }
      expectedTotalCents = dollarsToCents(params.orderSubtotal);
    }

    const expectedTotalDollars = centsToDollars(expectedTotalCents);
    if (expectedTotalCents <= 0) {
      throw new BadRequestException({
        code: ScannerErrorCode.INVALID_AMOUNT,
        message: ScannerErrorMessage.INVALID_AMOUNT,
      });
    }

    if (
      !usesStaffEnteredOfferAmount &&
      params.orderSubtotal != null &&
      Number.isFinite(params.orderSubtotal) &&
      !dollarsEqualInCents(params.orderSubtotal, expectedTotalDollars)
    ) {
      throw new BadRequestException({
        code: ScannerErrorCode.INVALID_AMOUNT,
        message: ScannerErrorMessage.INVALID_AMOUNT,
      });
    }

    const visitOrderSubtotalDollars =
      extraItemsCents > 0 ? centsToDollars(extraItemsCents) : null;
    const collectedAt = new Date();

    type PendingDeal = {
      funnel: Funnel & { campaign: Campaign };
      paymentId: number;
      amountCents: number;
      fromUnpaidOnlineCheckout: boolean;
    };

    type OrderActivityDraft = {
      orderId: number;
      amountCents: number;
      currency: string;
      paymentIds: number[];
      funnelIds: number[];
      campaignIds: number[];
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
      let newOrderTotalCents = 0;
      const newOrderPayments: Array<{
        funnel: Funnel & { campaign: Campaign };
        amountCents: number;
      }> = [];
      const orderActivityById = new Map<number, OrderActivityDraft>();

      const guestEmail = customer.email.trim().toLowerCase();

      const trackOrderActivity = (draft: OrderActivityDraft) => {
        const existing = orderActivityById.get(draft.orderId);
        if (!existing) {
          orderActivityById.set(draft.orderId, draft);
          return;
        }
        existing.amountCents = draft.amountCents;
        existing.currency = draft.currency;
        existing.paymentIds = [
          ...new Set([...existing.paymentIds, ...draft.paymentIds]),
        ];
        existing.funnelIds = [
          ...new Set([...existing.funnelIds, ...draft.funnelIds]),
        ];
        existing.campaignIds = [
          ...new Set([...existing.campaignIds, ...draft.campaignIds]),
        ];
      };

      for (const funnel of funnelsForPurchase) {
        const campaignPrice =
          funnel.campaign.price != null ? Number(funnel.campaign.price) : null;
        const hasCampaignPrice =
          campaignPrice != null &&
          Number.isFinite(campaignPrice) &&
          campaignPrice > 0;
        const amountCents = hasCampaignPrice
          ? dollarsToCents(campaignPrice)
          : Math.round(expectedTotalCents / funnelsForPurchase.length);

        // Reuse unpaid funnel checkout (registered online, pay at counter).
        let pending = await manager.findOne(FunnelPayment, {
          where: {
            funnelId: funnel.id,
            businessId,
            customerId,
            status: FunnelPaymentStatus.PENDING,
          },
          order: { createdAt: 'DESC' },
          lock: { mode: 'pessimistic_write' },
        });
        if (!pending && guestEmail) {
          pending = await manager.findOne(FunnelPayment, {
            where: {
              funnelId: funnel.id,
              businessId,
              customerEmail: guestEmail,
              status: FunnelPaymentStatus.PENDING,
            },
            order: { createdAt: 'DESC' },
            lock: { mode: 'pessimistic_write' },
          });
        }

        if (pending) {
          await manager.update(FunnelPayment, pending.id, {
            status: FunnelPaymentStatus.PAID,
            paidAt: collectedAt,
            amount: amountCents,
            customerId,
            campaignId: funnel.campaign.id,
            paymentSource: FunnelPaymentSource.SCANNER,
            collectionChannel: FunnelCollectionChannel.IN_STORE,
            paymentMethod: FunnelPaymentMethod.OTHER,
            paymentCollectedBy: staffUserId,
            paymentCollectedAt: collectedAt,
          });

          let orderId = pending.orderId;
          const orderCurrency = pending.currency || 'usd';
          if (orderId != null) {
            await manager.update(Order, orderId, {
              status: OrderStatus.PAID,
              source: OrderSource.SCANNER,
              totalAmount: amountCents,
              currency: orderCurrency,
              paidAt: collectedAt,
            });
          } else {
            const settledOrder = await manager.save(
              manager.create(Order, {
                businessId,
                status: OrderStatus.PAID,
                source: OrderSource.SCANNER,
                totalAmount: amountCents,
                currency: orderCurrency,
                paidAt: collectedAt,
              }),
            );
            orderId = settledOrder.id;
            await manager.update(FunnelPayment, pending.id, { orderId });
          }

          trackOrderActivity({
            orderId,
            amountCents,
            currency: orderCurrency,
            paymentIds: [pending.id],
            funnelIds: [funnel.id],
            campaignIds: [funnel.campaign.id],
          });

          created.push({
            funnel,
            paymentId: pending.id,
            amountCents,
            fromUnpaidOnlineCheckout: true,
          });
          continue;
        }

        newOrderTotalCents += amountCents;
        newOrderPayments.push({ funnel, amountCents });
      }

      if (newOrderPayments.length > 0) {
        const order = await manager.save(
          manager.create(Order, {
            businessId,
            status: OrderStatus.PAID,
            source: OrderSource.SCANNER,
            totalAmount: newOrderTotalCents,
            currency: 'usd',
            paidAt: collectedAt,
          }),
        );

        const batchPaymentIds: number[] = [];
        for (const row of newOrderPayments) {
          const payment = manager.create(FunnelPayment, {
            funnelId: row.funnel.id,
            businessId,
            campaignId: row.funnel.campaign.id,
            customerId,
            orderId: order.id,
            amount: row.amountCents,
            currency: 'usd',
            status: FunnelPaymentStatus.PAID,
            customerEmail: guestEmail,
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
          batchPaymentIds.push(savedPayment.id);
          created.push({
            funnel: row.funnel,
            paymentId: savedPayment.id,
            amountCents: row.amountCents,
            fromUnpaidOnlineCheckout: false,
          });
        }

        trackOrderActivity({
          orderId: order.id,
          amountCents: newOrderTotalCents,
          currency: 'usd',
          paymentIds: batchPaymentIds,
          funnelIds: newOrderPayments.map((row) => row.funnel.id),
          campaignIds: newOrderPayments.map((row) => row.funnel.campaign.id),
        });
      }

      if (created.length === 0) {
        throw new BadRequestException('Select at least one deal.');
      }

      for (const draft of orderActivityById.values()) {
        await this.customerActivityService.recordInStorePurchase({
          businessId,
          customerId,
          orderId: draft.orderId,
          amountCents: draft.amountCents,
          currency: draft.currency,
          funnelPaymentIds: draft.paymentIds,
          funnelIds: draft.funnelIds,
          campaignIds: draft.campaignIds,
          staffUserId,
          occurredAt: collectedAt,
          manager,
        });
      }

      const primaryOrderId =
        (
          await manager.findOne(FunnelPayment, {
            where: { id: created[0]!.paymentId },
          })
        )?.orderId ?? null;

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

      return {
        orderId: primaryOrderId,
        deals: created,
        orderActivities: [...orderActivityById.values()],
      };
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
    const visitCampaignIds = [
      ...new Set(deals.map((deal) => deal.funnel.campaign.id)),
    ];

    try {
      for (const deal of deals) {
        const { funnel, paymentId, amountCents } = deal;
        const funnelId = funnel.id;

        const existingPass = await this.couponService.findByCustomerAndFunnel(
          customerId,
          funnelId,
        );
        const hasUnpaidOnlinePass =
          existingPass != null &&
          existingPass.status === CouponStatus.ACTIVE &&
          existingPass.paymentStatus === CouponPaymentStatus.PENDING &&
          !this.couponService.isExpired(existingPass);

        // Coupons only for unpaid online / signup passes. Fresh counter Business deals: pay only.
        const shouldIssueOrUpgradeCoupon =
          deal.fromUnpaidOnlineCheckout || hasUnpaidOnlinePass;

        if (shouldIssueOrUpgradeCoupon) {
          await this.track(
            {
              eventType: FunnelEventType.SIGNUP,
              funnelId,
              customerId,
              visitorId: `scanner-${staffUserId}`,
            },
            { skipPendingOrder: true },
          );

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
            purchaseMeans,
          });
          continue;
        }

        purchased.push({
          funnelId,
          campaignName: funnel.campaign.campaignName,
          couponId: null,
          purchaseMeans,
        });
      }

      if (visitCampaignIds.length > 0) {
        const primaryCoupon = issuedCoupons[0] ?? null;
        if (primaryCoupon) {
          const existingVisit = await this.customerVisitRepository.findOne({
            where: { couponId: primaryCoupon.couponId },
          });
          if (!existingVisit) {
            const savedVisit = await this.customerVisitRepository.save({
              customerId,
              campaignId: primaryCoupon.campaignId,
              businessId,
              couponId: primaryCoupon.couponId,
              orderId,
              staffUserId,
              visitedAt: collectedAt,
              source: CustomerVisitSource.STAFF_LOOKUP,
              orderSubtotal: visitOrderSubtotalDollars,
              extraItems:
                visitOrderSubtotalDollars != null &&
                visitOrderSubtotalDollars > 0
                  ? normalizedExtraItems
                  : null,
              visitCampaigns: visitCampaignIds.map((campaignId) => ({
                campaignId,
              })),
            });
            await replaceVisitAddonItems(this.dataSource.manager, {
              customerVisitId: savedVisit.id,
              businessId,
              customerId,
              campaignId: primaryCoupon.campaignId,
              orderId,
              staffUserId,
              source: VisitAddonItemSource.SCANNER_PURCHASE,
              items:
                visitOrderSubtotalDollars != null &&
                visitOrderSubtotalDollars > 0
                  ? normalizedExtraItems
                  : [],
            });
          } else if (
            visitOrderSubtotalDollars != null &&
            visitOrderSubtotalDollars > 0
          ) {
            existingVisit.orderSubtotal = visitOrderSubtotalDollars;
            existingVisit.extraItems =
              normalizedExtraItems.length > 0 ? normalizedExtraItems : null;
            if (existingVisit.orderId == null && orderId != null) {
              existingVisit.orderId = orderId;
            }
            await this.customerVisitRepository.save(existingVisit);
            await replaceVisitAddonItems(this.dataSource.manager, {
              customerVisitId: existingVisit.id,
              businessId,
              customerId,
              campaignId: existingVisit.campaignId,
              orderId: existingVisit.orderId,
              staffUserId,
              source: VisitAddonItemSource.SCANNER_PURCHASE,
              items: normalizedExtraItems,
            });
          }
        } else {
          const primaryCampaignId = visitCampaignIds[0]!;
          const savedVisit = await this.customerVisitRepository.save({
            customerId,
            campaignId: primaryCampaignId,
            businessId,
            couponId: null,
            orderId,
            staffUserId,
            visitedAt: collectedAt,
            source: CustomerVisitSource.STAFF_LOOKUP,
            orderSubtotal: visitOrderSubtotalDollars,
            extraItems:
              visitOrderSubtotalDollars != null &&
              visitOrderSubtotalDollars > 0
                ? normalizedExtraItems
                : null,
            visitCampaigns: visitCampaignIds.map((campaignId) => ({
              campaignId,
            })),
          });
          await replaceVisitAddonItems(this.dataSource.manager, {
            customerVisitId: savedVisit.id,
            businessId,
            customerId,
            campaignId: primaryCampaignId,
            orderId,
            staffUserId,
            source: VisitAddonItemSource.SCANNER_PURCHASE,
            items:
              visitOrderSubtotalDollars != null &&
              visitOrderSubtotalDollars > 0
                ? normalizedExtraItems
                : [],
          });
        }
      }

      if (idempotencyKey) {
        await this.scannerPurchaseRequestRepository.update(
          { businessId, idempotencyKey },
          { responseJson: purchased },
        );
      }

      try {
        const guestName =
          customer.name?.trim() || customer.email?.trim() || 'Guest';
        const dealNames =
          purchased
            .map((row) => row.campaignName?.trim())
            .filter(Boolean)
            .join(', ') || 'deal';
        await this.businessHistoryService.logScannerPurchase({
          businessId,
          customerName: guestName,
          dealNames,
          amountLabel:
            extraItemsCents > 0
              ? `$${expectedTotalDollars.toFixed(2)} (+ $${centsToDollars(extraItemsCents).toFixed(2)} extras${
                  normalizedExtraItemNames.length > 0
                    ? `: ${normalizedExtraItemNames.join(', ')}`
                    : ''
                })`
              : `$${expectedTotalDollars.toFixed(2)}`,
          couponIds: purchased
            .map((row) => row.couponId)
            .filter((id): id is number => id != null && id > 0),
          actorUserId: staffUserId,
          idempotencyKey,
          occurredAt: collectedAt,
        });
      } catch (historyError) {
        this.logger.error(
          'Failed to write scanner purchase business history',
          historyError instanceof Error ? historyError.stack : historyError,
        );
      }

      for (let index = 0; index < deals.length; index += 1) {
        const deal = deals[index]!;
        try {
          await this.activityService.logPrepaidForOffer({
            paymentId: deal.paymentId,
            customerId,
            occurredAt: collectedAt,
            extraItemsCents: index === 0 ? extraItemsCents : 0,
            extraItemNames:
              index === 0 && extraItemsCents > 0
                ? normalizedExtraItemNames
                : [],
            extraItems:
              index === 0 && extraItemsCents > 0 ? normalizedExtraItems : [],
          });
        } catch (activityError) {
          this.logger.warn(
            `Scanner purchase activity_event log failed payment=${deal.paymentId}: ${
              activityError instanceof Error
                ? activityError.message
                : String(activityError)
            }`,
          );
        }
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

    if (event.eventType === FunnelEventType.SIGNUP) {
      await this.customerActivityService.recordOnlineSignup({
        businessId: campaign.businessId,
        customerId: event.customerId,
        funnelId: funnel.id,
        campaignId: campaign.id,
        funnelEventId: event.id,
        occurredAt: event.createdAt,
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
      existing.updatedAt = new Date();
      return {
        event: await this.funnelEventRepository.save(existing),
        shouldRunAutomation: true,
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

  async getBusinessTopEarningCampaigns(params: {
    businessId: number;
    from?: Date | null;
    to?: Date | null;
    limit?: number;
  }): Promise<{
    businessId: number;
    from: string | null;
    to: string | null;
    totalEarningsCents: number;
    totalOrderCount: number;
    totalUniqueCustomerCount: number;
    totalRepeatedCustomerCount: number;
    previousPeriod: {
      totalEarningsCents: number;
      totalOrderCount: number;
      totalUniqueCustomerCount: number;
    } | null;
    dailyTotals: Array<{
      date: string;
      earningsCents: number;
      orderCount: number;
      uniqueCustomerCount: number;
    }>;
    dailyByCampaign: Array<{
      date: string;
      campaignId: number;
      earningsCents: number;
      orderCount: number;
      uniqueCustomerCount: number;
    }>;
    campaigns: Array<{
      campaignId: number;
      campaignName: string;
      campaignType: 'prepaid' | 'postpaid' | null;
      imageUrl: string | null;
      price: number | null;
      earningsCents: number;
      orderCount: number;
      paidPaymentCount: number;
      uniqueCustomerCount: number;
      guestCount: number;
      repeatedCustomerCount: number;
      viewCount: number;
      signupCount: number;
      newCustomerCount: number;
      returningCustomerCount: number;
    }>;
    conversionCampaigns: Array<{
      campaignId: number;
      campaignName: string;
      campaignType: 'prepaid' | 'postpaid' | null;
      imageUrl: string | null;
      viewCount: number;
      signupCount: number;
      orderCount: number;
    }>;
  }> {
    const limit = Math.min(50, Math.max(1, Math.round(params.limit ?? 10)));
    const cacheKey = [
      'perf-top-campaigns',
      params.businessId,
      params.from?.toISOString() ?? '',
      params.to?.toISOString() ?? '',
      limit,
    ].join(':');

    const cached = dashboardTtlCache.get<{
      businessId: number;
      from: string | null;
      to: string | null;
      totalEarningsCents: number;
      totalOrderCount: number;
      totalUniqueCustomerCount: number;
      totalRepeatedCustomerCount: number;
      previousPeriod: {
        totalEarningsCents: number;
        totalOrderCount: number;
        totalUniqueCustomerCount: number;
      } | null;
      dailyTotals: Array<{
        date: string;
        earningsCents: number;
        orderCount: number;
        uniqueCustomerCount: number;
      }>;
      dailyByCampaign: Array<{
        date: string;
        campaignId: number;
        earningsCents: number;
        orderCount: number;
        uniqueCustomerCount: number;
      }>;
      campaigns: Array<{
        campaignId: number;
        campaignName: string;
        campaignType: 'prepaid' | 'postpaid' | null;
        imageUrl: string | null;
        price: number | null;
        earningsCents: number;
        orderCount: number;
        paidPaymentCount: number;
        uniqueCustomerCount: number;
        guestCount: number;
        repeatedCustomerCount: number;
        viewCount: number;
        signupCount: number;
        newCustomerCount: number;
        returningCustomerCount: number;
      }>;
      conversionCampaigns: Array<{
        campaignId: number;
        campaignName: string;
        campaignType: 'prepaid' | 'postpaid' | null;
        imageUrl: string | null;
        viewCount: number;
        signupCount: number;
        orderCount: number;
      }>;
    }>(cacheKey);
    if (cached) return cached;

    const applyFilters = (
      qb: ReturnType<Repository<FunnelPayment>['createQueryBuilder']>,
      from?: Date | null,
      to?: Date | null,
    ) =>
      applyPerformanceCampaignEarningsFilters(qb, {
        businessId: params.businessId,
        from,
        to,
      });

    const pairRows = await applyFilters(
      this.funnelPaymentRepository.createQueryBuilder('p'),
      params.from,
      params.to,
    )
      .select('p.campaign_id', 'campaignId')
      .addSelect('c.campaign_name', 'campaignName')
      .addSelect('c.campaign_type', 'campaignType')
      .addSelect('c.image_url', 'imageUrl')
      .addSelect('c.price', 'price')
      .addSelect('p.customer_id', 'customerId')
      .addSelect('COUNT(*)', 'paymentCount')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'earningsCents')
      .groupBy('p.campaign_id')
      .addGroupBy('c.campaign_name')
      .addGroupBy('c.campaign_type')
      .addGroupBy('c.image_url')
      .addGroupBy('c.price')
      .addGroupBy('p.customer_id')
      .getRawMany<{
        campaignId: string | number;
        campaignName: string | null;
        campaignType: string | null;
        imageUrl: string | null;
        price: string | number | null;
        customerId: string | number | null;
        paymentCount: string | number;
        earningsCents: string | number;
      }>();

    type CampaignAgg = {
      campaignId: number;
      campaignName: string;
      campaignType: 'prepaid' | 'postpaid' | null;
      imageUrl: string | null;
      price: number | null;
      earningsCents: number;
      orderCount: number;
      uniqueCustomerCount: number;
      repeatedCustomerCount: number;
      customerIds: Set<number>;
    };

    const byCampaign = new Map<number, CampaignAgg>();
    const businessCustomerPayments = new Map<number, number>();
    let totalEarningsCents = 0;

    for (const row of pairRows) {
      const campaignId = Number(row.campaignId);
      if (!Number.isFinite(campaignId) || campaignId <= 0) continue;

      const paymentCount = Math.max(
        0,
        Math.round(Number(row.paymentCount) || 0),
      );
      const earningsCents = Math.max(
        0,
        Math.round(Number(row.earningsCents) || 0),
      );
      totalEarningsCents += earningsCents;

      const customerIdRaw =
        row.customerId != null && row.customerId !== ''
          ? Number(row.customerId)
          : null;
      const hasCustomer =
        customerIdRaw != null &&
        Number.isFinite(customerIdRaw) &&
        customerIdRaw > 0;

      if (hasCustomer) {
        businessCustomerPayments.set(
          customerIdRaw,
          (businessCustomerPayments.get(customerIdRaw) ?? 0) + paymentCount,
        );
      }

      let agg = byCampaign.get(campaignId);
      if (!agg) {
        const campaignTypeRaw = String(row.campaignType ?? '')
          .trim()
          .toLowerCase();
        const campaignType =
          campaignTypeRaw === CampaignType.POSTPAID
            ? CampaignType.POSTPAID
            : campaignTypeRaw === CampaignType.PREPAID
              ? CampaignType.PREPAID
              : null;
        const priceRaw =
          row.price != null && row.price !== '' ? Number(row.price) : null;

        agg = {
          campaignId,
          campaignName: row.campaignName?.trim() || 'Campaign',
          campaignType,
          imageUrl: row.imageUrl?.trim() || null,
          price:
            priceRaw != null && Number.isFinite(priceRaw) && priceRaw >= 0
              ? Math.round(priceRaw * 100) / 100
              : null,
          earningsCents: 0,
          orderCount: 0,
          uniqueCustomerCount: 0,
          repeatedCustomerCount: 0,
          customerIds: new Set<number>(),
        };
        byCampaign.set(campaignId, agg);
      }

      agg.earningsCents += earningsCents;
      agg.orderCount += paymentCount;
      if (hasCustomer) {
        agg.uniqueCustomerCount += 1;
        agg.customerIds.add(customerIdRaw);
        if (paymentCount >= 2) {
          agg.repeatedCustomerCount += 1;
        }
      }
    }

    let totalUniqueCustomerCount = 0;
    let totalRepeatedCustomerCount = 0;
    let totalOrderCount = 0;
    for (const paymentCount of businessCustomerPayments.values()) {
      totalUniqueCustomerCount += 1;
      if (paymentCount >= 2) {
        totalRepeatedCustomerCount += 1;
      }
    }
    for (const agg of byCampaign.values()) {
      totalOrderCount += agg.orderCount;
    }

    let previousPeriod: {
      totalEarningsCents: number;
      totalOrderCount: number;
      totalUniqueCustomerCount: number;
    } | null = null;

    if (params.from && params.to) {
      const previousWindow = resolvePerformancePreviousWindow(
        params.from,
        params.to,
      );
      if (previousWindow) {
        const previousRow = await applyFilters(
          this.funnelPaymentRepository.createQueryBuilder('p'),
          previousWindow.previousFrom,
          previousWindow.previousTo,
        )
          .select('COALESCE(SUM(p.amount), 0)', 'totalEarningsCents')
          .addSelect('COUNT(*)', 'totalOrderCount')
          .addSelect(
            'COUNT(DISTINCT p.customer_id)',
            'totalUniqueCustomerCount',
          )
          .getRawOne<{
            totalEarningsCents: string | number;
            totalOrderCount: string | number;
            totalUniqueCustomerCount: string | number;
          }>();

        previousPeriod = {
          totalEarningsCents: Math.max(
            0,
            Math.round(Number(previousRow?.totalEarningsCents) || 0),
          ),
          totalOrderCount: Math.max(
            0,
            Math.round(Number(previousRow?.totalOrderCount) || 0),
          ),
          totalUniqueCustomerCount: Math.max(
            0,
            Math.round(Number(previousRow?.totalUniqueCustomerCount) || 0),
          ),
        };
      }
    }

    const rankedCampaigns = [...byCampaign.values()].sort((a, b) => {
      if (b.earningsCents !== a.earningsCents) {
        return b.earningsCents - a.earningsCents;
      }
      return a.campaignName.localeCompare(b.campaignName);
    });

    const limitedCampaigns = rankedCampaigns.slice(0, limit);

    const viewCountByCampaign = new Map<number, number>();
    const signupCountByCampaign = new Map<number, number>();
    const priorCustomerIds = new Set<number>();

    const allCustomerIds = [
      ...new Set(limitedCampaigns.flatMap((agg) => [...agg.customerIds])),
    ];

    if (params.from && params.to) {
      const viewRows = await this.dataSource
        .getRepository(FunnelAnalyticsEvent)
        .createQueryBuilder('ae')
        .innerJoin(Funnel, 'f', 'f.id = ae.funnel_id')
        .innerJoin(
          Campaign,
          'c',
          'c.id = f.campaign_id AND c.business_id = :businessId AND c.deleted_at IS NULL',
          { businessId: params.businessId },
        )
        .where('ae.event_type = :pageView', {
          pageView: FunnelAnalyticsEventType.PAGE_VIEW,
        })
        .andWhere('ae.deleted_at IS NULL')
        .andWhere('ae.created_at >= :from', { from: params.from })
        .andWhere('ae.created_at <= :to', { to: params.to })
        .select('f.campaign_id', 'campaignId')
        .addSelect('COUNT(*)', 'viewCount')
        .groupBy('f.campaign_id')
        .getRawMany<{ campaignId: string | number; viewCount: string | number }>();

      for (const row of viewRows) {
        const campaignId = Number(row.campaignId);
        if (!Number.isFinite(campaignId) || campaignId <= 0) continue;
        viewCountByCampaign.set(
          campaignId,
          Math.max(0, Math.round(Number(row.viewCount) || 0)),
        );
      }

      const signupRows = await this.funnelEventRepository
        .createQueryBuilder('e')
        .innerJoin(Funnel, 'f', 'f.id = e.funnel_id')
        .innerJoin(
          Campaign,
          'c',
          'c.id = f.campaign_id AND c.business_id = :businessId AND c.deleted_at IS NULL',
          { businessId: params.businessId },
        )
        .where('e.event_type = :signup', { signup: FunnelEventType.SIGNUP })
        .andWhere('e.deleted_at IS NULL')
        .andWhere('e.created_at >= :from', { from: params.from })
        .andWhere('e.created_at <= :to', { to: params.to })
        .select('f.campaign_id', 'campaignId')
        .addSelect('COUNT(*)', 'signupCount')
        .groupBy('f.campaign_id')
        .getRawMany<{
          campaignId: string | number;
          signupCount: string | number;
        }>();

      for (const row of signupRows) {
        const campaignId = Number(row.campaignId);
        if (!Number.isFinite(campaignId) || campaignId <= 0) continue;
        signupCountByCampaign.set(
          campaignId,
          Math.max(0, Math.round(Number(row.signupCount) || 0)),
        );
      }

      if (allCustomerIds.length > 0) {
        const priorRows = await applyFilters(
          this.funnelPaymentRepository.createQueryBuilder('p'),
          null,
          new Date(params.from.getTime() - 1),
        )
          .andWhere('p.customer_id IN (:...customerIds)', {
            customerIds: allCustomerIds,
          })
          .select('p.customer_id', 'customerId')
          .distinct(true)
          .getRawMany<{ customerId: string | number }>();

        for (const row of priorRows) {
          const customerId = Number(row.customerId);
          if (Number.isFinite(customerId) && customerId > 0) {
            priorCustomerIds.add(customerId);
          }
        }
      }
    }

    const campaigns = limitedCampaigns.map((agg) => {
      let newCustomerCount = 0;
      let returningCustomerCount = 0;
      for (const customerId of agg.customerIds) {
        if (priorCustomerIds.has(customerId)) {
          returningCustomerCount += 1;
        } else {
          newCustomerCount += 1;
        }
      }

      return {
        campaignId: agg.campaignId,
        campaignName: agg.campaignName,
        campaignType: agg.campaignType,
        imageUrl: agg.imageUrl,
        price: agg.price,
        earningsCents: agg.earningsCents,
        orderCount: agg.orderCount,
        paidPaymentCount: agg.orderCount,
        uniqueCustomerCount: agg.uniqueCustomerCount,
        guestCount: agg.uniqueCustomerCount,
        repeatedCustomerCount: agg.repeatedCustomerCount,
        viewCount: viewCountByCampaign.get(agg.campaignId) ?? 0,
        signupCount: signupCountByCampaign.get(agg.campaignId) ?? 0,
        newCustomerCount,
        returningCustomerCount,
      };
    });

    let conversionCampaigns = campaigns.slice(0, 3).map((row) => ({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      campaignType: row.campaignType,
      imageUrl: row.imageUrl,
      viewCount: row.viewCount,
      signupCount: row.signupCount,
      orderCount: row.orderCount,
    }));

    if (
      conversionCampaigns.length === 0 &&
      params.from &&
      params.to &&
      viewCountByCampaign.size > 0
    ) {
      const topViewIds = [...viewCountByCampaign.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 3)
        .map(([campaignId]) => campaignId);

      if (topViewIds.length > 0) {
        const trafficCampaigns = await this.campaignRepository.find({
          where: {
            businessId: params.businessId,
            id: In(topViewIds),
          },
        });
        const byId = new Map(trafficCampaigns.map((c) => [c.id, c]));
        conversionCampaigns = topViewIds
          .map((campaignId) => {
            const campaign = byId.get(campaignId);
            if (!campaign) return null;
            const campaignTypeRaw = String(campaign.campaignType ?? '')
              .trim()
              .toLowerCase();
            const campaignType =
              campaignTypeRaw === CampaignType.POSTPAID
                ? CampaignType.POSTPAID
                : campaignTypeRaw === CampaignType.PREPAID
                  ? CampaignType.PREPAID
                  : null;
            return {
              campaignId,
              campaignName: campaign.campaignName?.trim() || 'Campaign',
              campaignType,
              imageUrl: campaign.imageUrl?.trim() || null,
              viewCount: viewCountByCampaign.get(campaignId) ?? 0,
              signupCount: signupCountByCampaign.get(campaignId) ?? 0,
              orderCount: 0,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row != null);
      }
    }

    const topCampaignIds = new Set(
      campaigns.slice(0, 5).map((c) => c.campaignId),
    );
    const dailyTotalsMap = new Map<
      string,
      { earningsCents: number; orderCount: number; uniqueCustomerCount: number }
    >();
    const dailyByCampaignMap = new Map<
      string,
      { earningsCents: number; orderCount: number; uniqueCustomerCount: number }
    >();

    if (params.from && params.to) {
      const dailyRows = await applyFilters(
        this.funnelPaymentRepository.createQueryBuilder('p'),
        params.from,
        params.to,
      )
        .select(
          `to_char(
            date_trunc('day', COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'UTC'),
            'YYYY-MM-DD'
          )`,
          'day',
        )
        .addSelect('p.campaign_id', 'campaignId')
        .addSelect('COALESCE(SUM(p.amount), 0)', 'earningsCents')
        .addSelect('COUNT(*)', 'orderCount')
        .addSelect('COUNT(DISTINCT p.customer_id)', 'uniqueCustomerCount')
        .groupBy('day')
        .addGroupBy('p.campaign_id')
        .getRawMany<{
          day: string;
          campaignId: string | number;
          earningsCents: string | number;
          orderCount: string | number;
          uniqueCustomerCount: string | number;
        }>();

      for (const row of dailyRows) {
        const day = String(row.day ?? '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const campaignId = Number(row.campaignId);
        const earningsCents = Math.max(
          0,
          Math.round(Number(row.earningsCents) || 0),
        );
        const orderCount = Math.max(0, Math.round(Number(row.orderCount) || 0));
        const uniqueCustomerCount = Math.max(
          0,
          Math.round(Number(row.uniqueCustomerCount) || 0),
        );

        const total = dailyTotalsMap.get(day) ?? {
          earningsCents: 0,
          orderCount: 0,
          uniqueCustomerCount: 0,
        };
        total.earningsCents += earningsCents;
        total.orderCount += orderCount;
        total.uniqueCustomerCount += uniqueCustomerCount;
        dailyTotalsMap.set(day, total);

        if (
          Number.isFinite(campaignId) &&
          campaignId > 0 &&
          topCampaignIds.has(campaignId)
        ) {
          dailyByCampaignMap.set(`${day}:${campaignId}`, {
            earningsCents,
            orderCount,
            uniqueCustomerCount,
          });
        }
      }
    }

    const dayKeys = new Set<string>([
      ...dailyTotalsMap.keys(),
      ...[...dailyByCampaignMap.keys()].map((key) => key.split(':')[0]!),
    ]);
    if (params.from && params.to) {
      const cursor = new Date(
        Date.UTC(
          params.from.getUTCFullYear(),
          params.from.getUTCMonth(),
          params.from.getUTCDate(),
        ),
      );
      const end = new Date(
        Date.UTC(
          params.to.getUTCFullYear(),
          params.to.getUTCMonth(),
          params.to.getUTCDate(),
        ),
      );
      while (cursor.getTime() <= end.getTime()) {
        dayKeys.add(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const sortedDays = [...dayKeys].sort();
    const dailyTotals = sortedDays.map((date) => {
      const row = dailyTotalsMap.get(date);
      return {
        date,
        earningsCents: row?.earningsCents ?? 0,
        orderCount: row?.orderCount ?? 0,
        uniqueCustomerCount: row?.uniqueCustomerCount ?? 0,
      };
    });

    const dailyByCampaign: Array<{
      date: string;
      campaignId: number;
      earningsCents: number;
      orderCount: number;
      uniqueCustomerCount: number;
    }> = [];
    for (const date of sortedDays) {
      for (const campaignId of topCampaignIds) {
        const row = dailyByCampaignMap.get(`${date}:${campaignId}`);
        dailyByCampaign.push({
          date,
          campaignId,
          earningsCents: row?.earningsCents ?? 0,
          orderCount: row?.orderCount ?? 0,
          uniqueCustomerCount: row?.uniqueCustomerCount ?? 0,
        });
      }
    }

    const result = {
      businessId: params.businessId,
      from: params.from?.toISOString() ?? null,
      to: params.to?.toISOString() ?? null,
      totalEarningsCents,
      totalOrderCount,
      totalUniqueCustomerCount,
      totalRepeatedCustomerCount,
      previousPeriod,
      dailyTotals,
      dailyByCampaign,
      campaigns,
      conversionCampaigns,
    };
    dashboardTtlCache.set(cacheKey, result, DASHBOARD_CACHE_TTL_MS);
    return result;
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
      campaignType: 'prepaid' | 'postpaid' | null;
      campaignImageUrl: string | null;
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
      extraItems?: Array<{ name: string; unitPrice: number; qty: number }>;
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

    const [campaignCount, funnelCount, allEventsTotal] = await Promise.all([
      this.campaignRepository.count({
        where: { businessId },
      }),
      this.funnelRepository
        .createQueryBuilder('funnel')
        .innerJoin('funnel.campaign', 'campaign')
        .where('campaign.business_id = :businessId', { businessId })
        .getCount(),
      this.orderRepository
        .createQueryBuilder('ord')
        .where('ord.business_id = :businessId', { businessId })
        .andWhere('ord.deleted_at IS NULL')
        .getCount(),
    ]);

    const filteredQb = this.buildBusinessOrdersListQuery({
      businessId,
      statusFilter,
      dateFilter,
      search,
    });

    const total = await filteredQb.clone().getCount();

    const orders = await filteredQb
      .clone()
      .orderBy(this.businessOrdersListSortSql(), 'DESC')
      .addOrderBy('ord.id', 'DESC')
      .skip(pagination.skip)
      .take(pagination.limit)
      .getMany();

    const orderIds = orders.map((order) => order.id);
    const paymentsByOrderId = await this.loadPaymentsGroupedByOrderId(
      businessId,
      orderIds,
    );
    const allPaymentsForVisits = [...paymentsByOrderId.values()].flat();
    const paymentIdsForVisits = [
      ...new Set(allPaymentsForVisits.map((payment) => payment.id)),
    ];
    const visitByPaymentId = await this.loadVisitsByFunnelPaymentId(
      businessId,
      paymentIdsForVisits,
    );
    const visitByOrderId = await this.loadVisitsByOrderId(businessId, orderIds);

    const data = orders.map((order) =>
      this.mapOrderToBusinessRow(
        order,
        paymentsByOrderId.get(order.id) ?? [],
        visitByPaymentId,
        visitByOrderId.get(order.id) ?? null,
      ),
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

  private businessOrdersListSortSql(): string {
    return `COALESCE(
      ord.paid_at,
      (
        SELECT MAX(v.visit_date)
        FROM customer_visits v
        WHERE v.order_id = ord.id
          AND v.deleted_at IS NULL
      ),
      ord.created_at
    )`;
  }

  private businessOrdersPaidExistsSql(): string {
    return `(
      ord.status = :paidOrderStatus
      OR EXISTS (
        SELECT 1
        FROM funnel_payment p
        WHERE p.order_id = ord.id
          AND p.business_id = :businessId
          AND p.deleted_at IS NULL
          AND p.status = :paidPaymentStatus
      )
      OR EXISTS (
        SELECT 1
        FROM customer_visits v
        WHERE v.order_id = ord.id
          AND v.business_id = :businessId
          AND v.deleted_at IS NULL
          AND (
            COALESCE(v.order_subtotal, 0) > 0
            OR (
              v.extra_items IS NOT NULL
              AND jsonb_typeof(v.extra_items) = 'array'
              AND jsonb_array_length(v.extra_items) > 0
            )
            OR EXISTS (
              SELECT 1
              FROM visit_addon_items vai
              WHERE vai.customer_visit_id = v.id
            )
          )
      )
    )`;
  }

  private buildBusinessOrdersListQuery(params: {
    businessId: number;
    statusFilter: BusinessFunnelEventStatusFilter;
    dateFilter: BusinessFunnelEventDateFilter;
    search?: string;
  }): ReturnType<Repository<Order>['createQueryBuilder']> {
    const qb = this.orderRepository
      .createQueryBuilder('ord')
      .where('ord.business_id = :businessId', { businessId: params.businessId })
      .andWhere('ord.deleted_at IS NULL');

    if (params.statusFilter === 'paid') {
      qb.andWhere(this.businessOrdersPaidExistsSql(), {
        paidOrderStatus: OrderStatus.PAID,
        paidPaymentStatus: FunnelPaymentStatus.PAID,
        businessId: params.businessId,
      });
    } else if (params.statusFilter === 'not_paid') {
      qb.andWhere(`NOT ${this.businessOrdersPaidExistsSql()}`, {
        paidOrderStatus: OrderStatus.PAID,
        paidPaymentStatus: FunnelPaymentStatus.PAID,
        businessId: params.businessId,
      });
    }

    const dateFrom = getBusinessFunnelEventDateFrom(params.dateFilter);
    if (dateFrom) {
      qb.andWhere(`${this.businessOrdersListSortSql()} >= :dateFrom`, {
        dateFrom,
      });
    }

    if (params.search) {
      const searchPattern = `%${params.search.toLowerCase()}%`;
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM funnel_payment p
          LEFT JOIN customers c ON c.id = p.customer_id
          LEFT JOIN campaigns camp ON camp.id = p.campaign_id
          WHERE p.order_id = ord.id
            AND p.business_id = :businessId
            AND p.deleted_at IS NULL
            AND (
              LOWER(COALESCE(c.name, '')) LIKE :searchPattern
              OR LOWER(COALESCE(c.email, '')) LIKE :searchPattern
              OR LOWER(COALESCE(c.phone, '')) LIKE :searchPattern
              OR LOWER(COALESCE(p.customer_email, '')) LIKE :searchPattern
              OR LOWER(COALESCE(camp.campaign_name, '')) LIKE :searchPattern
            )
        )`,
        {
          businessId: params.businessId,
          searchPattern,
        },
      );
    }

    return qb;
  }

  async backfillPendingOrdersForOpenCheckouts(
    businessId: number,
  ): Promise<void> {
    const openPayments = await this.funnelPaymentRepository.find({
      where: {
        businessId,
        status: In([
          FunnelPaymentStatus.PENDING,
          FunnelPaymentStatus.FAILED,
          FunnelPaymentStatus.CANCELLED,
        ]),
        paymentSource: FunnelPaymentSource.STRIPE,
      },
      order: { createdAt: 'DESC' },
      take: 200,
    });

    for (const payment of openPayments) {
      if (payment.orderId != null) {
        continue;
      }
      if (payment.funnelId == null || payment.funnelId < 1) {
        continue;
      }
      if (
        !isOnlineFunnelPayment(payment) &&
        payment.collectionChannel !== FunnelCollectionChannel.ONLINE &&
        payment.paymentSource !== FunnelPaymentSource.STRIPE
      ) {
        continue;
      }

      const email = payment.customerEmail?.trim().toLowerCase();
      if (!email) {
        continue;
      }

      let customerId = payment.customerId;
      if (customerId == null) {
        const customer = await this.customerRepository
          .createQueryBuilder('c')
          .where('LOWER(c.email) = :email', { email })
          .getOne();
        customerId = customer?.id ?? null;
        if (customerId != null) {
          await this.funnelPaymentRepository.update(payment.id, {
            customerId,
          });
        }
      }

      const order = await this.orderRepository.save(
        this.orderRepository.create({
          businessId,
          status: OrderStatus.PENDING,
          source: OrderSource.STRIPE,
          totalAmount: payment.amount ?? 0,
          currency: payment.currency || 'usd',
          paidAt: null,
        }),
      );

      await this.funnelPaymentRepository.update(payment.id, {
        orderId: order.id,
      });
    }
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
        .where('payment.business_id = :businessId', { businessId })
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
    order: Order,
    payments: Array<
      FunnelPayment & {
        funnel: (Funnel & { campaign?: Campaign | null }) | null;
        campaign: Campaign | null;
        customerId: number | null;
        customer: Customer | null;
      }
    >,
    visitByPaymentId: Map<number, BusinessVisitSnapshot>,
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
    const campaignTypes: Array<'prepaid' | 'postpaid'> = [];
    const seenCampaignTypes = new Set<string>();
    let campaignImageUrl: string | null = null;
    let totalVisitNetDollars = 0;
    let receiptUrl: string | null = null;
    let paymentCollectedAt: Date | null = order.paidAt;
    let anyPaid = order.status === OrderStatus.PAID;
    const seenVisitIds = new Set<number>();
    let visitExtraItems: Array<{
      name: string;
      unitPrice: number;
      qty: number;
    }> = [];

    if (visitForOrder) {
      const addOn = visitAddOnAmountDollars({
        orderSubtotal: visitForOrder.orderSubtotal,
        extraItems: visitForOrder.extraItems,
      });
      if (addOn != null && addOn > 0) {
        totalVisitNetDollars = addOn;
        if (visitForOrder.visitId != null) {
          seenVisitIds.add(visitForOrder.visitId);
        }
        if (visitForOrder.extraItems?.length) {
          visitExtraItems = [...visitForOrder.extraItems];
        }
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
      const type =
        campaign?.campaignType === CampaignType.POSTPAID
          ? CampaignType.POSTPAID
          : campaign?.campaignType === CampaignType.PREPAID
            ? CampaignType.PREPAID
            : null;
      if (type && !seenCampaignTypes.has(type)) {
        seenCampaignTypes.add(type);
        campaignTypes.push(type);
      }
      if (!campaignImageUrl) {
        const imageUrl = campaign?.imageUrl?.trim();
        if (imageUrl) {
          campaignImageUrl = imageUrl;
        }
      }

      if (totalVisitNetDollars <= 0) {
        const visit = visitByPaymentId.get(payment.id) ?? null;
        if (
          visit &&
          (visit.visitId == null || !seenVisitIds.has(visit.visitId))
        ) {
          const addOn = visitAddOnAmountDollars({
            orderSubtotal: visit.orderSubtotal,
            extraItems: visit.extraItems,
          });
          if (addOn != null && addOn > 0) {
            if (visit.visitId != null) {
              seenVisitIds.add(visit.visitId);
            }
            totalVisitNetDollars += addOn;
            if (visit.extraItems?.length && visitExtraItems.length === 0) {
              visitExtraItems = [...visit.extraItems];
            }
          }
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

    const customer = primary?.customer ?? null;
    const paidAt = anyPaid
      ? (order.paidAt ?? primary?.paidAt ?? order.createdAt)
      : null;
    const unpaidActivityAt = !anyPaid
      ? this.latestTimestamp(
          order.updatedAt,
          primary?.updatedAt ?? null,
          order.createdAt,
        )
      : null;
    const rawOnlineAmountCents =
      order.totalAmount > 0
        ? order.totalAmount
        : sortedPayments.reduce(
            (sum, payment) =>
              payment.status === FunnelPaymentStatus.PAID
                ? sum + (payment.amount ?? 0)
                : sum,
            0,
          );
    const counterExtrasOnly = isCounterExtrasOnlyScannerPayment({
      onlineAmountCents: anyPaid ? rawOnlineAmountCents : null,
      businessAmountDollars: totalVisitNetDollars > 0 ? totalVisitNetDollars : null,
      paymentSource: primary?.paymentSource ?? null,
      collectionChannel: primary?.collectionChannel ?? null,
      orderSource: order.source ?? null,
    });
    const onlineAmountCents = counterExtrasOnly ? 0 : rawOnlineAmountCents;
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
      createdAt: paidAt ?? unpaidActivityAt ?? order.createdAt,
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
      campaignType:
        campaignTypes.length === 1
          ? campaignTypes[0]!
          : campaignTypes.length > 1
            ? campaignTypes[0]!
            : primary?.campaign?.campaignType === CampaignType.POSTPAID
              ? CampaignType.POSTPAID
              : primary?.campaign?.campaignType === CampaignType.PREPAID
                ? CampaignType.PREPAID
                : null,
      campaignImageUrl,
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
      amount: hasOnline ? onlineAmountCents : null,
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
      extraItems: hasBusiness && visitExtraItems.length > 0 ? visitExtraItems : [],
      paidAt: anyPaid ? paidAt : null,
      funnelPaymentId: primary?.id ?? null,
      paymentCollectedAt,
      orderId: order.id,
      paymentSource: primary?.paymentSource ?? null,
    };
  }

  private latestTimestamp(
    ...values: Array<Date | string | null | undefined>
  ): Date | null {
    let bestMs = NaN;
    let best: Date | null = null;
    for (const value of values) {
      if (value == null) {
        continue;
      }
      const asDate = value instanceof Date ? value : new Date(value);
      const ms = asDate.getTime();
      if (!Number.isFinite(ms)) {
        continue;
      }
      if (!Number.isFinite(bestMs) || ms >= bestMs) {
        bestMs = ms;
        best = asDate;
      }
    }
    return best;
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
      relations: { addonItems: true },
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
        extraItems: extraItemsForApi(resolveVisitStoredExtraItems(visit)),
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
      .leftJoinAndSelect('visit.addonItems', 'addonItems')
      .where('visit.businessId = :businessId', { businessId })
      .andWhere('coupon.funnelPaymentId IN (:...paymentIds)', { paymentIds })
      .andWhere('visit.deletedAt IS NULL')
      .orderBy('visit.visitedAt', 'DESC')
      .addOrderBy('addonItems.sortOrder', 'ASC')
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
        extraItems: extraItemsForApi(resolveVisitStoredExtraItems(visit)),
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
      relations: { visitCampaigns: true, addonItems: true },
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
          extraItems: extraItemsForApi(resolveVisitStoredExtraItems(visit)),
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
      status: 'new' | 'returning';
      tags: Array<'signup' | 'prepaid' | 'postpaid'>;
      hasPayment: boolean;
      eventCount: number;
    }>;
    meta: PaginationMeta;
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
      relations: ['campaign'],
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const campaignType = funnel.campaign?.campaignType ?? null;
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
      .addSelect('COUNT(event.id)', 'eventCount')
      .addSelect(
        `SUM(CASE WHEN event.event_type = 'payment' THEN 1 ELSE 0 END)`,
        'paymentCount',
      )
      .addSelect(
        `SUM(CASE WHEN event.event_type = 'signup' THEN 1 ELSE 0 END)`,
        'signupCount',
      )
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
        eventCount: string;
        paymentCount: string;
        signupCount: string;
      }>();

    return {
      data: rows.map((row) => {
        const eventCount = Number(row.eventCount ?? 0);
        const paymentCount = Number(row.paymentCount ?? 0);
        const signupCount = Number(row.signupCount ?? 0);
        const hasPayment = paymentCount > 0;
        const status: 'new' | 'returning' =
          eventCount > 1 || hasPayment ? 'returning' : 'new';
        const tags: Array<'signup' | 'prepaid' | 'postpaid'> = [];
        if (signupCount > 0 || eventCount > 0) {
          tags.push('signup');
        }
        if (campaignType === 'prepaid') {
          tags.push('prepaid');
        } else if (campaignType === 'postpaid') {
          tags.push('postpaid');
        }
        return {
          id: Number(row.id),
          name: row.name,
          email: row.email,
          phone: row.phone,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
          status,
          tags,
          hasPayment,
          eventCount,
        };
      }),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

}
