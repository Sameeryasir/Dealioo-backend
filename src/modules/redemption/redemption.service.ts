import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  CustomerVisit,
  CustomerVisitSource,
} from '../../db/entities/customer-visit.entity';
import { Customer } from '../../db/entities/customer.entity';
import {
  Coupon,
  CouponPaymentStatus,
  CouponStatus,
} from '../../db/entities/coupon.entity';
import {
  RedemptionEventType,
  RedemptionLog,
} from '../../db/entities/redemption-log.entity';
import { Business } from '../../db/entities/business.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import {
  FunnelPayment,
  FunnelPaymentMethod,
  FunnelPaymentSource,
  FunnelPaymentStatus,
  FunnelCollectionChannel,
} from '../../db/entities/funnel-payment.entity';
import {
  Order,
  OrderSource,
  OrderStatus,
} from '../../db/entities/order.entity';
import { ActivityService } from '../activity/activity.service';
import { AutomationService } from '../automation/automation.service';
import { BusinessAccessService } from '../business-access/business-access.service';
import { BusinessHistoryService } from '../business-history/business-history.service';
import { CustomerJourneyService } from '../customer-journey/customer-journey.service';
import {
  centsToDollars,
  dollarsEqualInCents,
  dollarsToCents,
} from '../../common/money.util';
import { CouponService } from './coupon.service';
import {
  isOnlineFunnelPayment,
  resolveGuestDealPaymentBadge,
} from '../../common/payment-provenance.util';
import { RedemptionValidationService } from './redemption-validation.service';
import { sanitizeScanToken } from './sanitize-scan-token';
import {
  ScannerErrorCode,
  ScannerErrorMessage,
} from './scanner-error-codes';

export type ScanAuditContext = {
  scannedBy: number | null;
  deviceInfo?: string;
  ipAddress?: string;
  idempotencyKey?: string;
  visitSource?: CustomerVisitSource;
};

export type ScanResult =
  | {
      success: true;
      customerName: string;
      campaignName: string;
      couponStatus: string;
      redeemedAt: string;
      totalVisits: number;
      rewardsAvailable: number;
      previouslyRedeemedCount: number;
    }
  | {
      success: false;
      message: string;
      errorCode?: string;
    };

export type ScanPreviewResult =
  | {
      success: true;
      customer: {
        id: number;
        name: string;
        email: string;
      };
      coupon: {
        id: number;
        status: string;
        paymentStatus: string;
        expiresAt: string | null;
        redeemedAt: string | null;
      };
      campaign: {
        id: number;
        name: string;
      };
      customerName: string;
      customerEmail: string;
      campaignName: string;
      totalVisits: number;
      rewardsAvailable: number;
      upcomingRewardsCount: number;
      previouslyRedeemedCount: number;
      previousRedemptions: Array<{
        campaignName: string;
        redeemedAt: string;
      }>;
      canRedeem: boolean;
      requiresWalkInPayment: boolean;
      redeemBlockedReason: string | null;
      paymentStatus: string;
      couponStatus: string;
      couponExpired: boolean;
      qrToken: string;
      scannedCouponId: number;
      availableRewards: Array<{
        couponId: number;
        label: string;
        paymentLabel: 'PREPAID' | 'UNPAID';
        campaignPrice: number | null;
        isScannedCoupon: boolean;
        canSelect: boolean;
      }>;
    }
  | {
      success: false;
      message: string;
      errorCode?: string;
    };

type CustomerVisitRecordResult = {
  recorded: boolean;
  customerId: number;
  campaignId: number | null;
};

export type GuestProfileResult = {
  customerId: number;
  customerName: string;
  email: string;
  phone: string | null;
  totalVisits: number;
  rewardsAvailable: number;
  upcomingRewardsCount: number;
  previouslyRedeemedCount: number;
  previousRedemptions: Array<{
    campaignName: string;
    redeemedAt: string;
  }>;
  activeDeals: Array<{
    couponId: number;
    funnelId: number | null;
    campaignId: number | null;
    campaignName: string;
    offerName: string;
    paymentLabel: 'PREPAID' | 'UNPAID';
    paymentStatus: CouponPaymentStatus;
    campaignPrice: number | null;
    expiresAt: string | null;
    canSelect: boolean;
    qrToken: string;
  }>;
};

@Injectable()
export class RedemptionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly couponService: CouponService,
    private readonly validationService: RedemptionValidationService,
    @InjectRepository(RedemptionLog)
    private readonly redemptionLogRepository: Repository<RedemptionLog>,
    @InjectRepository(CustomerVisit)
    private readonly customerVisitRepository: Repository<CustomerVisit>,
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @Inject(forwardRef(() => ActivityService))
    private readonly activityService: ActivityService,
    @Inject(forwardRef(() => AutomationService))
    private readonly automationService: AutomationService,
    private readonly businessAccessService: BusinessAccessService,
    private readonly customerJourneyService: CustomerJourneyService,
    private readonly businessHistoryService: BusinessHistoryService,
  ) {}

  extractToken(raw: string): string {
    const trimmed = sanitizeScanToken(raw);
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { token?: string };
        if (parsed.token?.trim()) {
          return sanitizeScanToken(parsed.token);
        }
      } catch {
        // fall through to raw token
      }
    }
    return trimmed;
  }

  async verifyBusinessAccess(
    businessId: number,
    userId: number,
    userRole: string,
  ): Promise<void> {
    const context = await this.businessAccessService.getAccessContext(
      { id: userId, role: { name: userRole } },
      businessId,
    );

    if (!context) {
      throw new ForbiddenException('You do not have access to this business');
    }

    if (
      context.access !== 'owner' &&
      context.access !== 'super_admin' &&
      !context.permissions.includes('scanning')
    ) {
      throw new ForbiddenException(
        'You do not have permission to scan or redeem for this business',
      );
    }
  }

  async getGuestProfile(
    customerId: number,
    businessId: number,
  ): Promise<GuestProfileResult | null> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      return null;
    }

    const profile = await this.getCustomerBusinessProfile(
      customerId,
      businessId,
    );
    const activeDeals = await this.getGuestActiveDeals(customerId, businessId);

    return {
      customerId: customer.id,
      customerName: customer.name?.trim() || 'Guest',
      email: customer.email,
      phone: customer.phone,
      totalVisits: profile.totalVisits,
      rewardsAvailable: activeDeals.length,
      upcomingRewardsCount: 0,
      previouslyRedeemedCount: profile.previouslyRedeemedCount,
      previousRedemptions: profile.previousRedemptions,
      activeDeals,
    };
  }

  async getGuestPreviousRedemptions(
    customerId: number,
    businessId: number,
    page = 1,
    limit = 10,
  ): Promise<{
    data: Array<{ campaignName: string; redeemedAt: string }>;
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('Guest not found');
    }

    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit) || 10));
    const skip = (safePage - 1) * safeLimit;

    const [rows, total] = await this.couponRepository.findAndCount({
      where: {
        customerId,
        businessId,
        status: CouponStatus.REDEEMED,
        paymentStatus: CouponPaymentStatus.PAID,
      },
      relations: ['campaign'],
      order: { redeemedAt: 'DESC', id: 'DESC' },
      skip,
      take: safeLimit,
    });

    const totalPages = Math.max(1, Math.ceil(total / safeLimit));

    return {
      data: rows.map((coupon) => ({
        campaignName: coupon.campaign?.campaignName?.trim() || 'Campaign',
        redeemedAt: coupon.redeemedAt
          ? coupon.redeemedAt.toISOString()
          : coupon.updatedAt?.toISOString?.() || new Date().toISOString(),
      })),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
      },
    };
  }

  async previewScan(
    rawToken: string,
    businessId: number,
    audit: ScanAuditContext,
  ): Promise<ScanPreviewResult> {
    const qrToken = this.extractToken(rawToken);

    if (!qrToken || qrToken.length < 8) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon: null,
        businessId,
        audit,
        success: false,
        failureReason: 'Invalid QR code',
      });
      return { success: false, message: 'Invalid QR code' };
    }

    const coupon = await this.couponService.findByQrToken(qrToken);

    if (!coupon) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon: null,
        businessId,
        audit,
        success: false,
        failureReason: 'Invalid QR code',
      });
      return { success: false, message: 'Invalid QR code' };
    }

    if (coupon.businessId !== businessId) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon,
        businessId,
        audit,
        success: false,
        failureReason: 'Business mismatch',
      });
      return {
        success: false,
        message: 'This coupon belongs to another business',
      };
    }

    const liveCoupon = await this.couponService.resolveLiveCouponForScan(coupon);

    if (!liveCoupon.customer) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon: liveCoupon,
        businessId,
        audit,
        success: false,
        failureReason: 'Customer not found',
      });
      return { success: false, message: 'Customer not found' };
    }

    if (!liveCoupon.campaign || liveCoupon.campaign.deletedAt) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon: liveCoupon,
        businessId,
        audit,
        success: false,
        failureReason: ScannerErrorMessage.CAMPAIGN_INACTIVE,
      });
      return {
        success: false,
        message: ScannerErrorMessage.CAMPAIGN_INACTIVE,
        errorCode: ScannerErrorCode.CAMPAIGN_INACTIVE,
      };
    }

    await this.couponService.syncPaymentStatusFromFunnelPayment(liveCoupon);

    const validation =
      this.validationService.validateCouponForRedemption(liveCoupon);

    const profile = await this.getCustomerBusinessProfile(
      liveCoupon.customerId,
      businessId,
    );

    const customerName = liveCoupon.customer.name?.trim() || 'Guest';
    const campaignName = liveCoupon.campaign.campaignName?.trim() || 'Campaign';

    const previewAllowed =
      validation.canRedeem || validation.requiresWalkInPayment;

    await this.logAudit({
      eventType: previewAllowed
        ? RedemptionEventType.PREVIEW_SUCCESS
        : RedemptionEventType.PREVIEW_FAILURE,
      coupon: liveCoupon,
      businessId,
      audit,
      success: previewAllowed,
      failureReason: validation.redeemBlockedReason,
    });

    return {
      success: true,
      customer: {
        id: liveCoupon.customer.id,
        name: customerName,
        email: liveCoupon.customer.email,
      },
      coupon: {
        id: liveCoupon.id,
        status: liveCoupon.status,
        paymentStatus: liveCoupon.paymentStatus,
        expiresAt: liveCoupon.expiresAt?.toISOString() ?? null,
        redeemedAt: liveCoupon.redeemedAt?.toISOString() ?? null,
      },
      campaign: {
        id: liveCoupon.campaign.id,
        name: campaignName,
      },
      customerName,
      customerEmail: liveCoupon.customer.email,
      campaignName,
      totalVisits: profile.totalVisits,
      rewardsAvailable: profile.rewardsAvailable,
      upcomingRewardsCount: 0,
      previouslyRedeemedCount: profile.previouslyRedeemedCount,
      previousRedemptions: profile.previousRedemptions,
      canRedeem: validation.canRedeem,
      requiresWalkInPayment: validation.requiresWalkInPayment,
      redeemBlockedReason: validation.redeemBlockedReason,
      paymentStatus: validation.paymentStatus,
      couponStatus: validation.couponStatus,
      couponExpired: validation.couponExpired,
      qrToken: liveCoupon.qrToken,
      scannedCouponId: liveCoupon.id,
      availableRewards: await this.getAvailableRewards(
        liveCoupon.customerId,
        businessId,
        liveCoupon.id,
        liveCoupon.paymentStatus === CouponPaymentStatus.PAID
          ? 'PREPAID'
          : 'UNPAID',
      ),
    };
  }

  /** Confirms redemption and creates the customer visit only after staff selects rewards. */
  async scan(
    rawToken: string,
    businessId: number,
    audit: ScanAuditContext,
    couponIds?: number[],
    orderSubtotal?: number,
    extraItemsAmount?: number,
  ): Promise<ScanResult> {
    if (audit.idempotencyKey?.trim()) {
      const cached = await this.findIdempotentRedemption(
        audit.idempotencyKey.trim(),
        businessId,
      );
      if (cached) {
        return cached;
      }
    }

    const qrToken = this.extractToken(rawToken);
    const coupon = await this.couponService.findByQrToken(qrToken);

    if (!coupon) {
      await this.logAudit({
        eventType: RedemptionEventType.REDEEM_FAILURE,
        coupon: null,
        businessId,
        audit,
        success: false,
        failureReason: ScannerErrorMessage.COUPON_NOT_FOUND,
      });
      return {
        success: false,
        message: ScannerErrorMessage.COUPON_NOT_FOUND,
        errorCode: ScannerErrorCode.COUPON_NOT_FOUND,
      };
    }

    if (coupon.businessId !== businessId) {
      await this.logAudit({
        eventType: RedemptionEventType.REDEEM_FAILURE,
        coupon,
        businessId,
        audit,
        success: false,
        failureReason: ScannerErrorMessage.WRONG_BUSINESS,
      });
      return {
        success: false,
        message: ScannerErrorMessage.WRONG_BUSINESS,
        errorCode: ScannerErrorCode.WRONG_BUSINESS,
      };
    }

    const liveCoupon = await this.couponService.resolveLiveCouponForScan(coupon);

    await this.couponService.syncPaymentStatusFromFunnelPayment(liveCoupon);

    // QR scan redeems only the coupon row for this token.
    // Staff lookup may redeem multiple selected deals for the same guest.
    const idsToRedeem =
      audit.visitSource === CustomerVisitSource.STAFF_LOOKUP &&
      couponIds?.length
        ? couponIds
        : [liveCoupon.id];

    if (audit.visitSource !== CustomerVisitSource.STAFF_LOOKUP) {
      const validation = this.validationService.validateCouponForRedemption(
        liveCoupon,
        { orderSubtotal },
      );
      if (!validation.canRedeem) {
        await this.logAudit({
          eventType: RedemptionEventType.REDEEM_FAILURE,
          coupon: liveCoupon,
          businessId,
          audit,
          success: false,
          failureReason: validation.redeemBlockedReason ?? 'Redemption blocked',
        });
        return {
          success: false,
          message: validation.redeemBlockedReason ?? 'Redemption blocked',
          errorCode: validation.errorCode ?? undefined,
        };
      }
    }

    return this.redeemSelectedCoupons(
      idsToRedeem,
      businessId,
      audit,
      orderSubtotal,
      extraItemsAmount,
    );
  }

  private async redeemSelectedCoupons(
    couponIds: number[],
    businessId: number,
    audit: ScanAuditContext,
    orderSubtotal?: number,
    extraItemsAmount?: number,
  ): Promise<ScanResult> {
    const uniqueIds = [...new Set(couponIds)].sort((a, b) => a - b);
    if (uniqueIds.length === 0) {
      return { success: false, message: 'Select at least one reward' };
    }

    if (uniqueIds.length > 1) {
      return {
        success: false,
        message: 'Redeem one guest deal at a time',
      };
    }

    if (audit.idempotencyKey?.trim()) {
      const cached = await this.findIdempotentRedemption(
        audit.idempotencyKey.trim(),
        businessId,
      );
      if (cached) {
        return cached;
      }
    }

    const redeemedAt = new Date();
    const resumeTarget: {
      value: { customerId: number; campaignId: number } | null;
    } = { value: null };
    const historyHint: {
      value: {
        collectedPayment: boolean;
        amountLabel: string;
        couponIds: number[];
        customerName: string;
        campaignName: string;
      } | null;
    } = { value: null };

    const result = await this.dataSource.transaction(async (manager) => {
      const lockedCoupons: Coupon[] = [];
      const business = await manager.findOne(Business, {
        where: { id: businessId },
      });
      const businessName = business?.name?.trim() || 'Business';

      for (const couponId of uniqueIds) {
        const locked = await this.lockCouponForRedemption(manager, couponId);

        if (!locked) {
          await this.logAuditInTransaction(manager, {
            eventType: RedemptionEventType.REDEEM_FAILURE,
            coupon: null,
            businessId,
            audit,
            success: false,
            failureReason: ScannerErrorMessage.COUPON_NOT_FOUND,
          });
          return {
            success: false,
            message: ScannerErrorMessage.COUPON_NOT_FOUND,
            errorCode: ScannerErrorCode.COUPON_NOT_FOUND,
          } as ScanResult;
        }

        lockedCoupons.push(locked);
      }

      const customerId = lockedCoupons[0].customerId;
      if (
        !lockedCoupons.every(
          (coupon) =>
            coupon.customerId === customerId &&
            coupon.businessId === businessId,
        )
      ) {
        await this.logAuditInTransaction(manager, {
          eventType: RedemptionEventType.REDEEM_FAILURE,
          coupon: lockedCoupons[0],
          businessId,
          audit,
          success: false,
          failureReason: ScannerErrorMessage.INVALID_SELECTION,
        });
        return {
          success: false,
          message: ScannerErrorMessage.INVALID_SELECTION,
          errorCode: ScannerErrorCode.INVALID_SELECTION,
        } as ScanResult;
      }

      for (const coupon of lockedCoupons) {
        await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);
      }

      const hasPrepaid = lockedCoupons.some(
        (coupon) => coupon.paymentStatus === CouponPaymentStatus.PAID,
      );
      const hasUnpaid = lockedCoupons.some(
        (coupon) => coupon.paymentStatus !== CouponPaymentStatus.PAID,
      );
      if (hasPrepaid && hasUnpaid) {
        await this.logAuditInTransaction(manager, {
          eventType: RedemptionEventType.REDEEM_FAILURE,
          coupon: lockedCoupons[0],
          businessId,
          audit,
          success: false,
          failureReason: ScannerErrorMessage.MIXED_PAYMENT_TYPES,
        });
        return {
          success: false,
          message: ScannerErrorMessage.MIXED_PAYMENT_TYPES,
          errorCode: ScannerErrorCode.MIXED_PAYMENT_TYPES,
        } as ScanResult;
      }

      if (hasUnpaid) {
        const campaignPrices = lockedCoupons.map((coupon) => {
          if (coupon.campaign?.price == null) return null;
          const price = Number(coupon.campaign.price);
          return Number.isFinite(price) && price >= 0 ? price : null;
        });
        const hasAllPrices = campaignPrices.every((price) => price != null);
        if (hasAllPrices) {
          const expectedTotal = campaignPrices.reduce<number>(
            (sum, price) => sum + (price as number),
            0,
          );
          const entered =
            orderSubtotal != null && Number.isFinite(orderSubtotal)
              ? orderSubtotal
              : null;
          if (
            entered == null ||
            !dollarsEqualInCents(entered, expectedTotal)
          ) {
            await this.logAuditInTransaction(manager, {
              eventType: RedemptionEventType.REDEEM_FAILURE,
              coupon: lockedCoupons[0],
              businessId,
              audit,
              success: false,
              failureReason: ScannerErrorMessage.INVALID_AMOUNT,
            });
            return {
              success: false,
              message: ScannerErrorMessage.INVALID_AMOUNT,
              errorCode: ScannerErrorCode.INVALID_AMOUNT,
            } as ScanResult;
          }
        }
      }

      for (const coupon of lockedCoupons) {
        const validation = this.validationService.validateCouponForRedemption(
          coupon,
          { orderSubtotal },
        );
        if (!validation.canRedeem) {
          await this.logAuditInTransaction(manager, {
            eventType: RedemptionEventType.REDEEM_FAILURE,
            coupon,
            businessId,
            audit,
            success: false,
            failureReason: validation.redeemBlockedReason ?? 'Redemption blocked',
          });
          return {
            success: false,
            message: validation.redeemBlockedReason ?? 'Redemption blocked',
            errorCode: validation.errorCode ?? undefined,
          } as ScanResult;
        }
      }

      const settledOrderIdByCouponId = new Map<number, number>();

      for (const coupon of lockedCoupons) {
        const walkInPayment =
          coupon.paymentStatus === CouponPaymentStatus.PENDING;

        const updateResult = await manager.update(
          Coupon,
          { id: coupon.id, status: CouponStatus.ACTIVE },
          {
            status: CouponStatus.REDEEMED,
            redeemedAt,
            redeemedByUserId: audit.scannedBy,
            scannerDevice: audit.deviceInfo?.slice(0, 255) ?? null,
            ...(walkInPayment
              ? { paymentStatus: CouponPaymentStatus.PAID }
              : {}),
          },
        );

        if (!updateResult.affected) {
          await this.logAuditInTransaction(manager, {
            eventType: RedemptionEventType.REDEEM_FAILURE,
            coupon,
            businessId,
            audit,
            success: false,
            failureReason: ScannerErrorMessage.ALREADY_REDEEMED,
          });
          return {
            success: false,
            message: ScannerErrorMessage.ALREADY_REDEEMED,
            errorCode: ScannerErrorCode.ALREADY_REDEEMED,
          } as ScanResult;
        }

        if (walkInPayment) {
          const settledOrderId = await this.settleUnpaidFunnelCheckoutAtCounter(
            manager,
            {
              coupon,
              businessId,
              staffUserId: audit.scannedBy,
              paidAt: redeemedAt,
            },
          );
          if (settledOrderId != null) {
            settledOrderIdByCouponId.set(coupon.id, settledOrderId);
          }
        }

        await this.logAuditInTransaction(manager, {
          eventType: RedemptionEventType.REDEEM_SUCCESS,
          coupon,
          businessId,
          audit,
          success: true,
          failureReason: null,
        });

        await this.activityService.logRedeemedReward({
          businessId,
          customerId: coupon.customerId,
          coupon,
          businessName,
          occurredAt: redeemedAt,
          manager,
        });
      }

      const primaryCoupon = lockedCoupons[0];
      const visitOrderSubtotal = await this.resolveVisitOrderSubtotal(
        manager,
        lockedCoupons,
        orderSubtotal,
        hasPrepaid && !hasUnpaid,
        extraItemsAmount,
      );

      // Visit activity 1ms after redeem so newest-first feed shows Scanned above Redeemed.
      await this.recordVisitFromQrScan({
        coupon: primaryCoupon,
        businessId,
        audit,
        visitedAt: redeemedAt,
        activityOccurredAt: new Date(redeemedAt.getTime() + 1),
        orderSubtotal: visitOrderSubtotal,
        orderId: settledOrderIdByCouponId.get(primaryCoupon.id) ?? null,
        manager,
        businessName,
      });

      resumeTarget.value = {
        customerId: primaryCoupon.customerId,
        campaignId: primaryCoupon.campaignId,
      };

      const successResult = await this.buildRedeemSuccessResult(
        manager,
        primaryCoupon,
        lockedCoupons,
        redeemedAt,
      );

      if (successResult.success) {
        // History shows offer/campaign price only (not visit total with extras).
        const offerDollars = lockedCoupons.reduce((sum, coupon) => {
          const price = Number(coupon.campaign?.price);
          return Number.isFinite(price) && price >= 0 ? sum + price : sum;
        }, 0);
        historyHint.value = {
          collectedPayment: hasUnpaid,
          amountLabel:
            offerDollars > 0 ? `$${offerDollars.toFixed(2)}` : 'payment',
          couponIds: lockedCoupons.map((coupon) => coupon.id),
          customerName: successResult.customerName,
          campaignName: successResult.campaignName,
        };
      }

      return successResult;
    });

    if (resumeTarget.value) {
      await this.notifyAutomationAfterVisit({
        recorded: true,
        customerId: resumeTarget.value.customerId,
        campaignId: resumeTarget.value.campaignId,
      });
    }

    if (result.success && historyHint.value) {
      const hint = historyHint.value;
      try {
        await this.businessHistoryService.logScannerRedeemed({
          businessId,
          customerName: hint.customerName,
          campaignName: hint.campaignName,
          couponIds: hint.couponIds,
          actorUserId: audit.scannedBy,
          occurredAt: redeemedAt,
        });
        if (hint.collectedPayment) {
          await this.businessHistoryService.logScannerPayment({
            businessId,
            customerName: hint.customerName,
            campaignName: hint.campaignName,
            amountLabel: hint.amountLabel,
            couponIds: hint.couponIds,
            actorUserId: audit.scannedBy,
            occurredAt: redeemedAt,
          });
        }
      } catch (error) {
        console.error('Failed to write scanner redeem business history', error);
      }
    }

    return result;
  }

  private async settleUnpaidFunnelCheckoutAtCounter(
    manager: EntityManager,
    params: {
      coupon: Coupon;
      businessId: number;
      staffUserId: number | null;
      paidAt: Date;
    },
  ): Promise<number | null> {
    const { coupon, businessId, staffUserId, paidAt } = params;

    let payment: FunnelPayment | null = null;
    if (coupon.funnelPaymentId != null) {
      payment = await manager.findOne(FunnelPayment, {
        where: { id: coupon.funnelPaymentId },
        lock: { mode: 'pessimistic_write' },
      });
    }

    if (
      payment == null ||
      (payment.status !== FunnelPaymentStatus.PENDING &&
        payment.status !== FunnelPaymentStatus.PAID)
    ) {
      if (coupon.funnelId != null && coupon.customerId != null) {
        payment = await manager.findOne(FunnelPayment, {
          where: {
            funnelId: coupon.funnelId,
            businessId,
            customerId: coupon.customerId,
            status: FunnelPaymentStatus.PENDING,
          },
          order: { createdAt: 'DESC' },
          lock: { mode: 'pessimistic_write' },
        });
      }
    }

    if (!payment) {
      return null;
    }

    await manager.update(FunnelPayment, payment.id, {
      status: FunnelPaymentStatus.PAID,
      paidAt: payment.paidAt ?? paidAt,
      paymentSource: FunnelPaymentSource.SCANNER,
      collectionChannel: FunnelCollectionChannel.IN_STORE,
      paymentMethod: FunnelPaymentMethod.OTHER,
      paymentCollectedBy: staffUserId,
      paymentCollectedAt: paidAt,
      customerId: coupon.customerId ?? payment.customerId ?? null,
    });
    payment.status = FunnelPaymentStatus.PAID;
    payment.paidAt = payment.paidAt ?? paidAt;
    payment.customerId = coupon.customerId ?? payment.customerId ?? null;
    payment.paymentCollectedBy = staffUserId;

    if (coupon.funnelPaymentId !== payment.id) {
      await manager.update(Coupon, coupon.id, {
        funnelPaymentId: payment.id,
      });
    }

    let orderId = payment.orderId;
    if (orderId != null) {
      await manager.update(Order, orderId, {
        status: OrderStatus.PAID,
        source: OrderSource.SCANNER,
        totalAmount: payment.amount,
        currency: payment.currency || 'usd',
        paidAt: payment.paidAt ?? paidAt,
      });
    } else {
      const order = await manager.save(
        manager.create(Order, {
          businessId,
          status: OrderStatus.PAID,
          source: OrderSource.SCANNER,
          totalAmount: payment.amount,
          currency: payment.currency || 'usd',
          paidAt: payment.paidAt ?? paidAt,
        }),
      );
      orderId = order.id;
      await manager.update(FunnelPayment, payment.id, { orderId });
      payment.orderId = orderId;
    }

    await manager.update(
      FunnelEvent,
      { funnelPaymentId: payment.id },
      {
        eventType: FunnelEventType.PAYMENT,
        paymentStatus: FunnelPaymentStatus.PAID,
        amount: payment.amount,
        currency: payment.currency || 'usd',
      },
    );

    return orderId;
  }

  private async recordVisitFromQrScan(params: {
    coupon: Coupon;
    businessId: number;
    audit: ScanAuditContext;
    visitedAt?: Date;
    activityOccurredAt?: Date;
    orderSubtotal?: number | null;
    orderId?: number | null;
    manager?: EntityManager;
    businessName?: string;
  }): Promise<CustomerVisitRecordResult> {
    const visitedAt = params.visitedAt ?? new Date();
    const activityOccurredAt = params.activityOccurredAt ?? visitedAt;
    const manager = params.manager ?? this.dataSource.manager;

    const existingVisit = await manager.findOne(CustomerVisit, {
      where: { couponId: params.coupon.id },
    });
    if (existingVisit) {
      let changed = false;
      if (
        params.orderSubtotal != null &&
        Number.isFinite(params.orderSubtotal)
      ) {
        existingVisit.orderSubtotal = params.orderSubtotal;
        changed = true;
      }
      if (params.orderId != null && existingVisit.orderId == null) {
        existingVisit.orderId = params.orderId;
        changed = true;
      }
      if (changed) {
        await manager.save(existingVisit);
      }
      return {
        recorded: false,
        customerId: params.coupon.customerId,
        campaignId: params.coupon.campaignId,
      };
    }

    let businessName = params.businessName?.trim();
    if (!businessName) {
      const business = await manager.findOne(Business, {
        where: { id: params.businessId },
      });
      businessName = business?.name?.trim() || 'Business';
    }

    const visit = manager.create(CustomerVisit, {
      customerId: params.coupon.customerId,
      campaignId: params.coupon.campaignId,
      businessId: params.businessId,
      couponId: params.coupon.id,
      orderId: params.orderId ?? null,
      staffUserId: params.audit.scannedBy,
      visitedAt,
      source:
        params.audit.visitSource ?? CustomerVisitSource.QR_REDEMPTION,
      orderSubtotal: params.orderSubtotal ?? null,
      visitCampaigns: [{ campaignId: params.coupon.campaignId }],
    });
    await manager.save(visit);

    const visitSource =
      params.audit.visitSource ?? CustomerVisitSource.QR_REDEMPTION;

    await this.activityService.logVisited({
      businessId: params.businessId,
      customerId: params.coupon.customerId,
      couponId: params.coupon.id,
      businessName,
      occurredAt: activityOccurredAt,
      visitSource,
      offerName:
        params.coupon.campaign?.offer?.trim() ||
        params.coupon.campaign?.campaignName?.trim() ||
        null,
      manager: params.manager,
    });

    if (visitSource !== CustomerVisitSource.STAFF_LOOKUP) {
      await this.customerJourneyService.recordQrRedeemed({
        businessId: params.businessId,
        customerId: params.coupon.customerId,
        campaignId: params.coupon.campaignId,
        funnelId: params.coupon.funnelId ?? null,
        couponId: params.coupon.id,
        funnelPaymentId: params.coupon.funnelPaymentId ?? null,
        occurredAt: visitedAt,
        source: 'qr_redemption',
        manager: params.manager,
      });
    }

    return {
      recorded: true,
      customerId: params.coupon.customerId,
      campaignId: params.coupon.campaignId,
    };
  }

  private async notifyAutomationAfterVisit(
    visit: CustomerVisitRecordResult,
  ): Promise<void> {
    if (!visit.recorded || !visit.campaignId) {
      return;
    }

    try {
      await this.automationService.resumeWaitingExecutionsAfterCustomerVisit(
        visit.customerId,
        visit.campaignId,
      );
    } catch (error) {
      // Visit recording must succeed even if automation resume fails.
      console.error('Failed to resume prepaid-offer automation after visit', error);
    }
  }

  private async buildRedeemSuccessResult(
    manager: EntityManager,
    primaryCoupon: Coupon,
    redeemedCoupons: Coupon[],
    redeemedAt: Date,
  ): Promise<ScanResult> {
    const customerId = primaryCoupon.customerId;
    const businessId = primaryCoupon.businessId;

    const customerName = primaryCoupon.customer?.name?.trim() || 'Guest';
    const campaignName =
      redeemedCoupons.length === 1
        ? primaryCoupon.campaign?.campaignName?.trim() || 'Campaign'
        : `${redeemedCoupons.length} rewards`;

    const totalVisits = await manager.count(CustomerVisit, {
      where: { customerId, businessId },
    });

    const activeCoupons = await manager.find(Coupon, {
      where: {
        customerId,
        businessId,
        status: CouponStatus.ACTIVE,
        paymentStatus: CouponPaymentStatus.PAID,
      },
    });
    const rewardsAvailable = activeCoupons.filter(
      (activeCoupon) => !this.couponService.isExpired(activeCoupon),
    ).length;

    const previouslyRedeemedCount = await manager.count(Coupon, {
      where: {
        customerId,
        businessId,
        status: CouponStatus.REDEEMED,
      },
    });

    return {
      success: true,
      customerName,
      campaignName,
      couponStatus: CouponStatus.REDEEMED,
      redeemedAt: redeemedAt.toISOString(),
      totalVisits,
      rewardsAvailable,
      previouslyRedeemedCount,
    };
  }

  private async findIdempotentRedemption(
    idempotencyKey: string,
    businessId: number,
  ): Promise<ScanResult | null> {
    const priorLog = await this.redemptionLogRepository.findOne({
      where: {
        idempotencyKey,
        businessId,
        success: true,
        eventType: RedemptionEventType.REDEEM_SUCCESS,
      },
      order: { id: 'DESC' },
    });

    if (!priorLog?.couponId) {
      return null;
    }

    const coupon = await this.couponRepository.findOne({
      where: { id: priorLog.couponId },
      relations: ['customer', 'campaign'],
    });

    if (!coupon) {
      return null;
    }

    const redeemedAt = coupon.redeemedAt ?? priorLog.scannedAt;
    const totalVisits = await this.customerVisitRepository.count({
      where: { customerId: coupon.customerId, businessId },
    });

    const activeCoupons = await this.couponRepository.find({
      where: {
        customerId: coupon.customerId,
        businessId,
        status: CouponStatus.ACTIVE,
        paymentStatus: CouponPaymentStatus.PAID,
      },
    });
    const rewardsAvailable = activeCoupons.filter(
      (activeCoupon) => !this.couponService.isExpired(activeCoupon),
    ).length;

    const previouslyRedeemedCount = await this.couponRepository.count({
      where: {
        customerId: coupon.customerId,
        businessId,
        status: CouponStatus.REDEEMED,
      },
    });

    return {
      success: true,
      customerName: coupon.customer?.name?.trim() || 'Guest',
      campaignName: coupon.campaign?.campaignName?.trim() || 'Campaign',
      couponStatus: CouponStatus.REDEEMED,
      redeemedAt: redeemedAt.toISOString(),
      totalVisits,
      rewardsAvailable,
      previouslyRedeemedCount,
    };
  }

  async getBusinessStats(businessId: number): Promise<{
    couponsIssued: number;
    couponsRedeemed: number;
    businessVisits: number;
    redemptionRate: number;
  }> {
    const couponsIssued = await this.couponRepository.count({
      where: { businessId },
    });
    const couponsRedeemed = await this.couponRepository.count({
      where: { businessId, status: CouponStatus.REDEEMED },
    });
    const businessVisits = await this.customerVisitRepository.count({
      where: { businessId },
    });
    const redemptionRate =
      couponsIssued > 0
        ? Math.round((couponsRedeemed / couponsIssued) * 10000) / 100
        : 0;

    return {
      couponsIssued,
      couponsRedeemed,
      businessVisits,
      redemptionRate,
    };
  }

  private async getCustomerBusinessProfile(
    customerId: number,
    businessId: number,
  ): Promise<{
    totalVisits: number;
    rewardsAvailable: number;
    previouslyRedeemedCount: number;
    previousRedemptions: Array<{ campaignName: string; redeemedAt: string }>;
  }> {
    const totalVisits = await this.customerVisitRepository.count({
      where: { customerId, businessId },
    });

    const customerCoupons = await this.couponRepository.find({
      where: {
        customerId,
        businessId,
        paymentStatus: CouponPaymentStatus.PAID,
      },
      relations: ['campaign'],
      order: { redeemedAt: 'DESC' },
    });

    const rewardsAvailable = customerCoupons.filter(
      (coupon) =>
        coupon.status === CouponStatus.ACTIVE &&
        !this.couponService.isExpired(coupon),
    ).length;

    const redeemedCoupons = customerCoupons.filter(
      (coupon) => coupon.status === CouponStatus.REDEEMED,
    );

    return {
      totalVisits,
      rewardsAvailable,
      previouslyRedeemedCount: redeemedCoupons.length,
      previousRedemptions: redeemedCoupons
        .filter((coupon) => coupon.redeemedAt)
        .map((coupon) => ({
          campaignName: coupon.campaign?.campaignName?.trim() || 'Campaign',
          redeemedAt: coupon.redeemedAt!.toISOString(),
        })),
    };
  }

  private async getAvailableRewards(
    customerId: number,
    businessId: number,
    scannedCouponId: number,
    scannedPaymentLabel: 'PREPAID' | 'UNPAID',
  ): Promise<
    Array<{
      couponId: number;
      label: string;
      paymentLabel: 'PREPAID' | 'UNPAID';
      campaignPrice: number | null;
      isScannedCoupon: boolean;
      canSelect: boolean;
    }>
  > {
    const coupon = await this.couponRepository.findOne({
      where: {
        id: scannedCouponId,
        customerId,
        businessId,
        status: CouponStatus.ACTIVE,
      },
      relations: ['campaign', 'funnelPayment'],
    });

    if (!coupon || this.couponService.isExpired(coupon)) {
      return [];
    }

    await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);

    const offer =
      coupon.campaign?.offer?.trim() ||
      coupon.campaign?.campaignName?.trim() ||
      'Reward';
    const isPrepaid = coupon.paymentStatus === CouponPaymentStatus.PAID;
    const paymentLabel = isPrepaid ? 'PREPAID' : 'UNPAID';

    if (paymentLabel !== scannedPaymentLabel) {
      return [];
    }

    const campaignPrice =
      coupon.campaign?.price != null ? Number(coupon.campaign.price) : null;

    return [
      {
        couponId: coupon.id,
        label: `${offer} [${paymentLabel}]`,
        paymentLabel,
        campaignPrice:
          campaignPrice != null && Number.isFinite(campaignPrice)
            ? campaignPrice
            : null,
        isScannedCoupon: true,
        canSelect:
          isPrepaid || coupon.paymentStatus === CouponPaymentStatus.PENDING,
      },
    ];
  }

  private async getGuestActiveDeals(
    customerId: number,
    businessId: number,
  ): Promise<
    Array<{
      couponId: number;
      funnelId: number | null;
      campaignId: number | null;
      campaignName: string;
      offerName: string;
      paymentLabel: 'PREPAID' | 'UNPAID';
      paymentBadge: 'PAID_ONLINE' | 'PAID_AT_COUNTER' | 'PENDING';
      paymentStatus: CouponPaymentStatus;
      campaignPrice: number | null;
      expiresAt: string | null;
      canSelect: boolean;
      qrToken: string;
    }>
  > {
    await this.ensureUnpaidFunnelDealsForGuest(customerId, businessId);

    const coupons = await this.couponRepository.find({
      where: { customerId, businessId, status: CouponStatus.ACTIVE },
      relations: ['campaign', 'funnelPayment'],
      order: { issuedAt: 'DESC' },
    });

    const results: Array<{
      couponId: number;
      funnelId: number | null;
      campaignId: number | null;
      campaignName: string;
      offerName: string;
      paymentLabel: 'PREPAID' | 'UNPAID';
      paymentBadge: 'PAID_ONLINE' | 'PAID_AT_COUNTER' | 'PENDING';
      paymentStatus: CouponPaymentStatus;
      campaignPrice: number | null;
      expiresAt: string | null;
      canSelect: boolean;
      qrToken: string;
    }> = [];

    for (const coupon of coupons) {
      if (this.couponService.isExpired(coupon)) {
        continue;
      }

      await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);

      if (!coupon.campaign || coupon.campaign.deletedAt) {
        continue;
      }

      const isPrepaid = coupon.paymentStatus === CouponPaymentStatus.PAID;

      // Unpaid guest deals only when tied to a real open checkout — not signup-only orphans.
      if (!isPrepaid) {
        if (
          coupon.paymentStatus !== CouponPaymentStatus.PENDING ||
          !this.isOpenOnlineCheckoutPayment(coupon.funnelPayment)
        ) {
          continue;
        }
      }

      const paymentBadge = resolveGuestDealPaymentBadge({
        couponPaid: isPrepaid,
        payment: coupon.funnelPayment,
      });

      if (isPrepaid && !isOnlineFunnelPayment(coupon.funnelPayment)) {
        continue;
      }

      const campaignName =
        coupon.campaign?.campaignName?.trim() || 'Campaign';
      const offerName =
        coupon.campaign?.offer?.trim() ||
        coupon.campaign?.campaignName?.trim() ||
        'Reward';
      const campaignPrice =
        coupon.campaign?.price != null ? Number(coupon.campaign.price) : null;

      results.push({
        couponId: coupon.id,
        funnelId: coupon.funnelId ?? null,
        campaignId: coupon.campaignId ?? coupon.campaign?.id ?? null,
        campaignName,
        offerName,
        paymentLabel: isPrepaid ? 'PREPAID' : 'UNPAID',
        paymentBadge,
        paymentStatus: coupon.paymentStatus,
        campaignPrice:
          campaignPrice != null && Number.isFinite(campaignPrice)
            ? campaignPrice
            : null,
        expiresAt: coupon.expiresAt?.toISOString() ?? null,
        canSelect:
          isPrepaid || coupon.paymentStatus === CouponPaymentStatus.PENDING,
        qrToken: coupon.qrToken,
      });
    }

    return results;
  }

  private async ensureUnpaidFunnelDealsForGuest(
    customerId: number,
    businessId: number,
  ): Promise<void> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    const email = customer?.email?.trim().toLowerCase() || null;

    // Only open online checkouts — do not recreate passes from signup history alone.
    const qb = this.funnelPaymentRepository
      .createQueryBuilder('fp')
      .where('fp.restaurant_id = :businessId', { businessId })
      .andWhere('fp.status IN (:...statuses)', {
        statuses: [
          FunnelPaymentStatus.PENDING,
          FunnelPaymentStatus.FAILED,
          FunnelPaymentStatus.CANCELLED,
        ],
      })
      .andWhere(
        '(fp.payment_source = :stripe OR fp.collection_channel = :online)',
        {
          stripe: FunnelPaymentSource.STRIPE,
          online: FunnelCollectionChannel.ONLINE,
        },
      )
      .andWhere('fp.funnel_id IS NOT NULL')
      .andWhere('fp.deleted_at IS NULL');

    if (email) {
      qb.andWhere(
        '(fp.customer_id = :customerId OR LOWER(fp.customer_email) = :email)',
        { customerId, email },
      );
    } else {
      qb.andWhere('fp.customer_id = :customerId', { customerId });
    }

    const pendingOnline = await qb
      .select('DISTINCT fp.funnel_id', 'funnelId')
      .getRawMany<{ funnelId: number | string }>();

    for (const row of pendingOnline) {
      const funnelId = Number(row.funnelId);
      if (!Number.isFinite(funnelId) || funnelId < 1) {
        continue;
      }
      await this.couponService.ensurePendingCouponForUnpaidFunnel(
        funnelId,
        customerId,
      );
    }
  }

  private isOpenOnlineCheckoutPayment(
    payment: FunnelPayment | null | undefined,
  ): boolean {
    if (!payment) {
      return false;
    }
    const open =
      payment.status === FunnelPaymentStatus.PENDING ||
      payment.status === FunnelPaymentStatus.FAILED ||
      payment.status === FunnelPaymentStatus.CANCELLED;
    if (!open) {
      return false;
    }
    return (
      payment.paymentSource === FunnelPaymentSource.STRIPE ||
      payment.collectionChannel === FunnelCollectionChannel.ONLINE
    );
  }

  private async logAudit(params: {
    eventType: RedemptionEventType;
    coupon: Coupon | null;
    businessId: number;
    audit: ScanAuditContext;
    success: boolean;
    failureReason: string | null;
  }): Promise<void> {
    await this.redemptionLogRepository.save({
      couponId: params.coupon?.id ?? null,
      customerId: params.coupon?.customerId ?? null,
      campaignId: params.coupon?.campaignId ?? null,
      businessId: params.businessId,
      scannedBy: params.audit.scannedBy,
      scannedAt: new Date(),
      deviceInfo: params.audit.deviceInfo ?? null,
      ipAddress: params.audit.ipAddress ?? null,
      idempotencyKey: params.audit.idempotencyKey?.trim() || null,
      eventType: params.eventType,
      success: params.success,
      failureReason: params.failureReason,
    });
  }

  private async resolveVisitOrderSubtotal(
    _manager: EntityManager,
    _lockedCoupons: Coupon[],
    orderSubtotal: number | undefined,
    allPrepaid: boolean,
    extraItemsAmount?: number,
  ): Promise<number | null> {
    const extraCents =
      extraItemsAmount != null &&
      Number.isFinite(extraItemsAmount) &&
      extraItemsAmount >= 0
        ? dollarsToCents(extraItemsAmount)
        : 0;

    // Store counter extras only — never deal/campaign price.
    if (allPrepaid) {
      const prepaidExtraCents =
        orderSubtotal != null &&
        Number.isFinite(orderSubtotal) &&
        orderSubtotal >= 0
          ? dollarsToCents(orderSubtotal)
          : 0;
      const combined = prepaidExtraCents + extraCents;
      return combined > 0 ? centsToDollars(combined) : null;
    }

    return extraCents > 0 ? centsToDollars(extraCents) : null;
  }

  private async lockCouponForRedemption(
    manager: EntityManager,
    couponId: number,
  ): Promise<Coupon | null> {
    const locked = await manager.findOne(Coupon, {
      where: { id: couponId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) {
      return null;
    }

    return (
      (await manager.findOne(Coupon, {
        where: { id: couponId },
        relations: ['customer', 'campaign', 'funnelPayment'],
      })) ?? locked
    );
  }

  private async logAuditInTransaction(
    manager: EntityManager,
    params: {
      eventType: RedemptionEventType;
      coupon: Coupon | null;
      businessId: number;
      audit: ScanAuditContext;
      success: boolean;
      failureReason: string | null;
    },
  ): Promise<void> {
    await manager.save(RedemptionLog, {
      couponId: params.coupon?.id ?? null,
      customerId: params.coupon?.customerId ?? null,
      campaignId: params.coupon?.campaignId ?? null,
      businessId: params.businessId,
      scannedBy: params.audit.scannedBy,
      scannedAt: new Date(),
      deviceInfo: params.audit.deviceInfo ?? null,
      ipAddress: params.audit.ipAddress ?? null,
      idempotencyKey: params.audit.idempotencyKey?.trim() || null,
      eventType: params.eventType,
      success: params.success,
      failureReason: params.failureReason,
    });
  }
}
