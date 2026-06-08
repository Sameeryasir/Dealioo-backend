import {
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { Restaurant } from '../../db/entities/restaurant.entity';
import { CouponService } from './coupon.service';
import { RedemptionValidationService } from './redemption-validation.service';
import { sanitizeScanToken } from './sanitize-scan-token';

export type ScanAuditContext = {
  scannedBy: number | null;
  deviceInfo?: string;
  ipAddress?: string;
  idempotencyKey?: string;
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
        isScannedCoupon: boolean;
        canSelect: boolean;
      }>;
    }
  | {
      success: false;
      message: string;
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
    campaignName: string;
    offerName: string;
    paymentLabel: 'PREPAID' | 'UNPAID';
    paymentStatus: CouponPaymentStatus;
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
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
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

  async verifyRestaurantAccess(
    restaurantId: number,
    userId: number,
    userRole: string,
  ): Promise<void> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
      relations: ['owner'],
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (userRole === 'Admin' && restaurant.owner?.id !== userId) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }
  }

  async getGuestProfile(
    customerId: number,
    restaurantId: number,
  ): Promise<GuestProfileResult | null> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      return null;
    }

    const profile = await this.getCustomerRestaurantProfile(
      customerId,
      restaurantId,
    );
    const activeDeals = await this.getGuestActiveDeals(customerId, restaurantId);

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

  /**
   * Preview only — never redeems, creates visits, or mutates coupon state.
   * Logs every preview attempt for audit.
   */
  async previewScan(
    rawToken: string,
    restaurantId: number,
    audit: ScanAuditContext,
  ): Promise<ScanPreviewResult> {
    const qrToken = this.extractToken(rawToken);

    if (!qrToken || qrToken.length < 8) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon: null,
        restaurantId,
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
        restaurantId,
        audit,
        success: false,
        failureReason: 'Invalid QR code',
      });
      return { success: false, message: 'Invalid QR code' };
    }

    if (coupon.restaurantId !== restaurantId) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon,
        restaurantId,
        audit,
        success: false,
        failureReason: 'Restaurant mismatch',
      });
      return {
        success: false,
        message: 'This coupon belongs to another restaurant',
      };
    }

    if (!coupon.customer) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon,
        restaurantId,
        audit,
        success: false,
        failureReason: 'Customer not found',
      });
      return { success: false, message: 'Customer not found' };
    }

    if (!coupon.campaign) {
      await this.logAudit({
        eventType: RedemptionEventType.PREVIEW_FAILURE,
        coupon,
        restaurantId,
        audit,
        success: false,
        failureReason: 'Campaign not found',
      });
      return { success: false, message: 'Campaign not found' };
    }

    await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);

    const validation = this.validationService.validateCouponForRedemption(coupon);
    const profile = await this.getCustomerRestaurantProfile(
      coupon.customerId,
      restaurantId,
    );

    const customerName = coupon.customer.name?.trim() || 'Guest';
    const campaignName = coupon.campaign.campaignName?.trim() || 'Campaign';

    const previewAllowed =
      validation.canRedeem || validation.requiresWalkInPayment;

    await this.logAudit({
      eventType: previewAllowed
        ? RedemptionEventType.PREVIEW_SUCCESS
        : RedemptionEventType.PREVIEW_FAILURE,
      coupon,
      restaurantId,
      audit,
      success: previewAllowed,
      failureReason: validation.redeemBlockedReason,
    });

    return {
      success: true,
      customer: {
        id: coupon.customer.id,
        name: customerName,
        email: coupon.customer.email,
      },
      coupon: {
        id: coupon.id,
        status: coupon.status,
        paymentStatus: coupon.paymentStatus,
        expiresAt: coupon.expiresAt?.toISOString() ?? null,
        redeemedAt: coupon.redeemedAt?.toISOString() ?? null,
      },
      campaign: {
        id: coupon.campaign.id,
        name: campaignName,
      },
      customerName,
      customerEmail: coupon.customer.email,
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
      qrToken,
      scannedCouponId: coupon.id,
      availableRewards: await this.getAvailableRewards(
        coupon.customerId,
        restaurantId,
        coupon.id,
      ),
    };
  }

  /** Confirms redemption and creates the customer visit only after staff selects rewards. */
  async scan(
    rawToken: string,
    restaurantId: number,
    audit: ScanAuditContext,
    couponIds?: number[],
    orderSubtotal?: number,
  ): Promise<ScanResult> {
    if (audit.idempotencyKey?.trim()) {
      const cached = await this.findIdempotentRedemption(
        audit.idempotencyKey.trim(),
        restaurantId,
      );
      if (cached) {
        return cached;
      }
    }

    if (couponIds?.length) {
      return this.redeemSelectedCoupons(
        couponIds,
        restaurantId,
        audit,
        orderSubtotal,
      );
    }

    const qrToken = this.extractToken(rawToken);
    const coupon = await this.couponService.findByQrToken(qrToken);

    if (!coupon) {
      await this.logAudit({
        eventType: RedemptionEventType.REDEEM_FAILURE,
        coupon: null,
        restaurantId,
        audit,
        success: false,
        failureReason: 'Coupon not found',
      });
      return { success: false, message: 'Invalid QR code' };
    }

    if (coupon.restaurantId !== restaurantId) {
      await this.logAudit({
        eventType: RedemptionEventType.REDEEM_FAILURE,
        coupon,
        restaurantId,
        audit,
        success: false,
        failureReason: 'Restaurant mismatch',
      });
      return {
        success: false,
        message: 'This coupon belongs to another restaurant',
      };
    }

    await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);

    const validation = this.validationService.validateCouponForRedemption(
      coupon,
      { orderSubtotal },
    );
    if (!validation.canRedeem) {
      await this.logAudit({
        eventType: RedemptionEventType.REDEEM_FAILURE,
        coupon,
        restaurantId,
        audit,
        success: false,
        failureReason: validation.redeemBlockedReason ?? 'Redemption blocked',
      });
      return {
        success: false,
        message: validation.redeemBlockedReason ?? 'Redemption blocked',
      };
    }

    return this.redeemSelectedCoupons(
      [coupon.id],
      restaurantId,
      audit,
      orderSubtotal,
    );
  }

  private async redeemSelectedCoupons(
    couponIds: number[],
    restaurantId: number,
    audit: ScanAuditContext,
    orderSubtotal?: number,
  ): Promise<ScanResult> {
    const uniqueIds = [...new Set(couponIds)].sort((a, b) => a - b);
    if (uniqueIds.length === 0) {
      return { success: false, message: 'Select at least one reward' };
    }

    if (audit.idempotencyKey?.trim()) {
      const cached = await this.findIdempotentRedemption(
        audit.idempotencyKey.trim(),
        restaurantId,
      );
      if (cached) {
        return cached;
      }
    }

    const redeemedAt = new Date();

    return this.dataSource.transaction(async (manager) => {
      const lockedCoupons: Coupon[] = [];

      for (const couponId of uniqueIds) {
        const locked = await this.lockCouponForRedemption(manager, couponId);

        if (!locked) {
          await this.logAuditInTransaction(manager, {
            eventType: RedemptionEventType.REDEEM_FAILURE,
            coupon: null,
            restaurantId,
            audit,
            success: false,
            failureReason: 'Coupon not found',
          });
          return {
            success: false,
            message: 'One or more rewards were not found',
          } as ScanResult;
        }

        lockedCoupons.push(locked);
      }

      const customerId = lockedCoupons[0].customerId;
      if (
        !lockedCoupons.every(
          (coupon) =>
            coupon.customerId === customerId &&
            coupon.restaurantId === restaurantId,
        )
      ) {
        await this.logAuditInTransaction(manager, {
          eventType: RedemptionEventType.REDEEM_FAILURE,
          coupon: lockedCoupons[0],
          restaurantId,
          audit,
          success: false,
          failureReason: 'Invalid reward selection',
        });
        return { success: false, message: 'Invalid reward selection' } as ScanResult;
      }

      for (const coupon of lockedCoupons) {
        await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);

        const validation = this.validationService.validateCouponForRedemption(
          coupon,
          { orderSubtotal },
        );
        if (!validation.canRedeem) {
          await this.logAuditInTransaction(manager, {
            eventType: RedemptionEventType.REDEEM_FAILURE,
            coupon,
            restaurantId,
            audit,
            success: false,
            failureReason: validation.redeemBlockedReason ?? 'Redemption blocked',
          });
          return {
            success: false,
            message: validation.redeemBlockedReason ?? 'Redemption blocked',
          } as ScanResult;
        }
      }

      for (const coupon of lockedCoupons) {
        const walkInPayment =
          coupon.paymentStatus === CouponPaymentStatus.PENDING;

        const updateResult = await manager.update(
          Coupon,
          { id: coupon.id, status: CouponStatus.ACTIVE },
          {
            status: CouponStatus.REDEEMED,
            redeemedAt,
            ...(walkInPayment
              ? { paymentStatus: CouponPaymentStatus.PAID }
              : {}),
          },
        );

        if (!updateResult.affected) {
          await this.logAuditInTransaction(manager, {
            eventType: RedemptionEventType.REDEEM_FAILURE,
            coupon,
            restaurantId,
            audit,
            success: false,
            failureReason: 'Already redeemed',
          });
          return {
            success: false,
            message: 'Coupon already redeemed',
          } as ScanResult;
        }

        await this.logAuditInTransaction(manager, {
          eventType: RedemptionEventType.REDEEM_SUCCESS,
          coupon,
          restaurantId,
          audit,
          success: true,
          failureReason: null,
        });
      }

      const primaryCoupon = lockedCoupons[0];

      const existingVisit = await manager.findOne(CustomerVisit, {
        where: { couponId: primaryCoupon.id },
      });

      if (!existingVisit) {
        await manager.save(CustomerVisit, {
          customerId: primaryCoupon.customerId,
          campaignId: primaryCoupon.campaignId,
          restaurantId,
          couponId: primaryCoupon.id,
          staffUserId: audit.scannedBy,
          visitedAt: redeemedAt,
          source: CustomerVisitSource.QR_REDEMPTION,
          orderSubtotal: orderSubtotal ?? null,
        });
      }

      return this.buildRedeemSuccessResult(
        manager,
        primaryCoupon,
        lockedCoupons,
        redeemedAt,
      );
    });
  }

  private async buildRedeemSuccessResult(
    manager: EntityManager,
    primaryCoupon: Coupon,
    redeemedCoupons: Coupon[],
    redeemedAt: Date,
  ): Promise<ScanResult> {
    const customerId = primaryCoupon.customerId;
    const restaurantId = primaryCoupon.restaurantId;

    const customerName = primaryCoupon.customer?.name?.trim() || 'Guest';
    const campaignName =
      redeemedCoupons.length === 1
        ? primaryCoupon.campaign?.campaignName?.trim() || 'Campaign'
        : `${redeemedCoupons.length} rewards`;

    const totalVisits = await manager.count(CustomerVisit, {
      where: { customerId, restaurantId },
    });

    const activeCoupons = await manager.find(Coupon, {
      where: {
        customerId,
        restaurantId,
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
        restaurantId,
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
    restaurantId: number,
  ): Promise<ScanResult | null> {
    const priorLog = await this.redemptionLogRepository.findOne({
      where: {
        idempotencyKey,
        restaurantId,
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
      where: { customerId: coupon.customerId, restaurantId },
    });

    const activeCoupons = await this.couponRepository.find({
      where: {
        customerId: coupon.customerId,
        restaurantId,
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
        restaurantId,
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

  async getRestaurantStats(restaurantId: number): Promise<{
    couponsIssued: number;
    couponsRedeemed: number;
    restaurantVisits: number;
    redemptionRate: number;
  }> {
    const couponsIssued = await this.couponRepository.count({
      where: { restaurantId },
    });
    const couponsRedeemed = await this.couponRepository.count({
      where: { restaurantId, status: CouponStatus.REDEEMED },
    });
    const restaurantVisits = await this.customerVisitRepository.count({
      where: { restaurantId },
    });
    const redemptionRate =
      couponsIssued > 0
        ? Math.round((couponsRedeemed / couponsIssued) * 10000) / 100
        : 0;

    return {
      couponsIssued,
      couponsRedeemed,
      restaurantVisits,
      redemptionRate,
    };
  }

  private async getCustomerRestaurantProfile(
    customerId: number,
    restaurantId: number,
  ): Promise<{
    totalVisits: number;
    rewardsAvailable: number;
    previouslyRedeemedCount: number;
    previousRedemptions: Array<{ campaignName: string; redeemedAt: string }>;
  }> {
    const totalVisits = await this.customerVisitRepository.count({
      where: { customerId, restaurantId },
    });

    const customerCoupons = await this.couponRepository.find({
      where: {
        customerId,
        restaurantId,
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
    restaurantId: number,
    scannedCouponId: number,
  ): Promise<
    Array<{
      couponId: number;
      label: string;
      paymentLabel: 'PREPAID' | 'UNPAID';
      isScannedCoupon: boolean;
      canSelect: boolean;
    }>
  > {
    const coupons = await this.couponRepository.find({
      where: { customerId, restaurantId, status: CouponStatus.ACTIVE },
      relations: ['campaign', 'funnelPayment'],
      order: { issuedAt: 'ASC' },
    });

    const results: Array<{
      couponId: number;
      label: string;
      paymentLabel: 'PREPAID' | 'UNPAID';
      isScannedCoupon: boolean;
      canSelect: boolean;
    }> = [];
    for (const coupon of coupons) {
      if (this.couponService.isExpired(coupon)) {
        continue;
      }

      await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);

      const offer =
        coupon.campaign?.offer?.trim() ||
        coupon.campaign?.campaignName?.trim() ||
        'Reward';
      const isPrepaid = coupon.paymentStatus === CouponPaymentStatus.PAID;
      const paymentLabel = isPrepaid ? 'PREPAID' : 'UNPAID';

      results.push({
        couponId: coupon.id,
        label: `${offer} [${paymentLabel}]`,
        paymentLabel,
        isScannedCoupon: coupon.id === scannedCouponId,
        canSelect:
          isPrepaid || coupon.paymentStatus === CouponPaymentStatus.PENDING,
      });
    }

    return results;
  }

  private async getGuestActiveDeals(
    customerId: number,
    restaurantId: number,
  ): Promise<
    Array<{
      couponId: number;
      campaignName: string;
      offerName: string;
      paymentLabel: 'PREPAID' | 'UNPAID';
      paymentStatus: CouponPaymentStatus;
      expiresAt: string | null;
      canSelect: boolean;
      qrToken: string;
    }>
  > {
    const coupons = await this.couponRepository.find({
      where: { customerId, restaurantId, status: CouponStatus.ACTIVE },
      relations: ['campaign', 'funnelPayment'],
      order: { issuedAt: 'DESC' },
    });

    const results: Array<{
      couponId: number;
      campaignName: string;
      offerName: string;
      paymentLabel: 'PREPAID' | 'UNPAID';
      paymentStatus: CouponPaymentStatus;
      expiresAt: string | null;
      canSelect: boolean;
      qrToken: string;
    }> = [];

    for (const coupon of coupons) {
      if (this.couponService.isExpired(coupon)) {
        continue;
      }

      await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);

      const campaignName =
        coupon.campaign?.campaignName?.trim() || 'Campaign';
      const offerName =
        coupon.campaign?.offer?.trim() ||
        coupon.campaign?.campaignName?.trim() ||
        'Reward';
      const isPrepaid = coupon.paymentStatus === CouponPaymentStatus.PAID;

      results.push({
        couponId: coupon.id,
        campaignName,
        offerName,
        paymentLabel: isPrepaid ? 'PREPAID' : 'UNPAID',
        paymentStatus: coupon.paymentStatus,
        expiresAt: coupon.expiresAt?.toISOString() ?? null,
        canSelect:
          isPrepaid || coupon.paymentStatus === CouponPaymentStatus.PENDING,
        qrToken: coupon.qrToken,
      });
    }

    return results;
  }

  private async logAudit(params: {
    eventType: RedemptionEventType;
    coupon: Coupon | null;
    restaurantId: number;
    audit: ScanAuditContext;
    success: boolean;
    failureReason: string | null;
  }): Promise<void> {
    await this.redemptionLogRepository.save({
      couponId: params.coupon?.id ?? null,
      customerId: params.coupon?.customerId ?? null,
      campaignId: params.coupon?.campaignId ?? null,
      restaurantId: params.restaurantId,
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
      restaurantId: number;
      audit: ScanAuditContext;
      success: boolean;
      failureReason: string | null;
    },
  ): Promise<void> {
    await manager.save(RedemptionLog, {
      couponId: params.coupon?.id ?? null,
      customerId: params.coupon?.customerId ?? null,
      campaignId: params.coupon?.campaignId ?? null,
      restaurantId: params.restaurantId,
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
