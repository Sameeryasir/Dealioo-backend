import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CustomerVisit, CustomerVisitSource } from '../../db/entities/customer-visit.entity';
import { Customer } from '../../db/entities/customer.entity';
import {
  Coupon,
  CouponPaymentStatus,
  CouponStatus,
} from '../../db/entities/coupon.entity';
import { RedemptionLog } from '../../db/entities/redemption-log.entity';
import { CouponService } from './coupon.service';

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
      customerName: string;
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
      redeemBlockedReason: string | null;
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
};

@Injectable()
export class RedemptionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly couponService: CouponService,
    @InjectRepository(RedemptionLog)
    private readonly redemptionLogRepository: Repository<RedemptionLog>,
    @InjectRepository(CustomerVisit)
    private readonly customerVisitRepository: Repository<CustomerVisit>,
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  /** Parse raw token or JSON QR payload `{ couponId, token }`. */
  extractToken(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { token?: string };
        if (parsed.token?.trim()) {
          return parsed.token.trim();
        }
      } catch {
        // fall through to raw token
      }
    }
    return trimmed;
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

    return {
      customerId: customer.id,
      customerName: customer.name?.trim() || 'Guest',
      email: customer.email,
      phone: customer.phone,
      totalVisits: profile.totalVisits,
      rewardsAvailable: profile.rewardsAvailable,
      upcomingRewardsCount: 0,
      previouslyRedeemedCount: profile.previouslyRedeemedCount,
      previousRedemptions: profile.previousRedemptions,
    };
  }

  /** Lookup only — never redeems, logs visits, or updates analytics. */
  async previewScan(
    rawToken: string,
    restaurantId: number,
  ): Promise<ScanPreviewResult> {
    const qrToken = this.extractToken(rawToken);
    const coupon = await this.couponService.findByQrToken(qrToken);

    if (!coupon) {
      return { success: false, message: 'Invalid QR code' };
    }

    if (coupon.restaurantId !== restaurantId) {
      return {
        success: false,
        message: 'This coupon belongs to another restaurant',
      };
    }

    const profile = await this.getCustomerRestaurantProfile(
      coupon.customerId,
      restaurantId,
    );
    const customerName = coupon.customer?.name?.trim() || 'Guest';
    const campaignName = coupon.campaign?.campaignName?.trim() || 'Campaign';

    let canRedeem = true;
    let redeemBlockedReason: string | null = null;

    if (coupon.paymentStatus !== CouponPaymentStatus.PAID) {
      canRedeem = false;
      redeemBlockedReason = 'Payment not completed';
    } else if (this.couponService.isExpired(coupon)) {
      canRedeem = false;
      redeemBlockedReason = 'Coupon expired';
    } else if (coupon.status === CouponStatus.REDEEMED) {
      canRedeem = false;
      redeemBlockedReason = 'Coupon already redeemed';
    } else if (coupon.status !== CouponStatus.ACTIVE) {
      canRedeem = false;
      redeemBlockedReason = 'Coupon is not active';
    }

    return {
      success: true,
      customerName,
      campaignName,
      totalVisits: profile.totalVisits,
      rewardsAvailable: profile.rewardsAvailable,
      upcomingRewardsCount: 0,
      previouslyRedeemedCount: profile.previouslyRedeemedCount,
      previousRedemptions: profile.previousRedemptions,
      canRedeem,
      redeemBlockedReason,
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
    scannedBy: number | null,
    deviceInfo?: string,
    couponIds?: number[],
    orderSubtotal?: number,
  ): Promise<ScanResult> {
    if (couponIds?.length) {
      return this.redeemSelectedCoupons(
        couponIds,
        restaurantId,
        scannedBy,
        deviceInfo,
        orderSubtotal,
      );
    }

    const qrToken = this.extractToken(rawToken);
    const coupon = await this.couponService.findByQrToken(qrToken);

    if (!coupon) {
      await this.logFailure(null, restaurantId, scannedBy, deviceInfo, 'Coupon not found');
      return { success: false, message: 'Invalid QR code' };
    }

    if (coupon.restaurantId !== restaurantId) {
      await this.logFailure(
        coupon,
        restaurantId,
        scannedBy,
        deviceInfo,
        'Restaurant mismatch',
      );
      return { success: false, message: 'This coupon belongs to another restaurant' };
    }

    if (coupon.paymentStatus !== CouponPaymentStatus.PAID) {
      await this.logFailure(coupon, restaurantId, scannedBy, deviceInfo, 'Payment not completed');
      return { success: false, message: 'Payment not completed' };
    }

    if (this.couponService.isExpired(coupon)) {
      if (coupon.status === CouponStatus.ACTIVE) {
        await this.couponRepository.update(coupon.id, {
          status: CouponStatus.EXPIRED,
        });
      }
      await this.logFailure(coupon, restaurantId, scannedBy, deviceInfo, 'Coupon expired');
      return { success: false, message: 'Coupon expired' };
    }

    if (coupon.status === CouponStatus.REDEEMED) {
      await this.logFailure(coupon, restaurantId, scannedBy, deviceInfo, 'Already redeemed');
      return { success: false, message: 'Coupon already redeemed' };
    }

    if (coupon.status !== CouponStatus.ACTIVE) {
      await this.logFailure(coupon, restaurantId, scannedBy, deviceInfo, 'Coupon not active');
      return { success: false, message: 'Coupon is not active' };
    }

    const redeemedAt = new Date();

    return this.dataSource.transaction(async (manager) => {
      const updateResult = await manager.update(
        Coupon,
        { id: coupon.id, status: CouponStatus.ACTIVE },
        { status: CouponStatus.REDEEMED, redeemedAt },
      );

      if (!updateResult.affected) {
        await this.logFailure(coupon, restaurantId, scannedBy, deviceInfo, 'Already redeemed');
        return { success: false, message: 'Coupon already redeemed' } as ScanResult;
      }

      await manager.save(RedemptionLog, {
        couponId: coupon.id,
        customerId: coupon.customerId,
        campaignId: coupon.campaignId,
        restaurantId,
        scannedBy,
        scannedAt: redeemedAt,
        deviceInfo: deviceInfo ?? null,
        success: true,
        failureReason: null,
      });

      await manager.save(CustomerVisit, {
        customerId: coupon.customerId,
        campaignId: coupon.campaignId,
        restaurantId,
        couponId: coupon.id,
        staffUserId: scannedBy,
        visitedAt: redeemedAt,
        source: CustomerVisitSource.QR_REDEMPTION,
        orderSubtotal: orderSubtotal ?? null,
      });

      const customerName = coupon.customer?.name?.trim() || 'Guest';
      const campaignName = coupon.campaign?.campaignName?.trim() || 'Campaign';

      const totalVisits = await manager.count(CustomerVisit, {
        where: { customerId: coupon.customerId, restaurantId },
      });

      const activeCoupons = await manager.find(Coupon, {
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

      const previouslyRedeemedCount = await manager.count(Coupon, {
        where: {
          customerId: coupon.customerId,
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
    });
  }

  private async redeemSelectedCoupons(
    couponIds: number[],
    restaurantId: number,
    scannedBy: number | null,
    deviceInfo?: string,
    orderSubtotal?: number,
  ): Promise<ScanResult> {
    const uniqueIds = [...new Set(couponIds)];
    if (uniqueIds.length === 0) {
      return { success: false, message: 'Select at least one reward' };
    }

    const coupons = await this.couponRepository.find({
      where: { id: In(uniqueIds) },
      relations: ['customer', 'campaign'],
      order: { id: 'ASC' },
    });

    if (coupons.length !== uniqueIds.length) {
      return { success: false, message: 'One or more rewards were not found' };
    }

    const customerId = coupons[0].customerId;
    if (
      !coupons.every(
        (coupon) =>
          coupon.customerId === customerId &&
          coupon.restaurantId === restaurantId,
      )
    ) {
      return { success: false, message: 'Invalid reward selection' };
    }

    for (const coupon of coupons) {
      if (coupon.paymentStatus !== CouponPaymentStatus.PAID) {
        return {
          success: false,
          message: 'Only prepaid rewards can be redeemed',
        };
      }
      if (this.couponService.isExpired(coupon)) {
        return { success: false, message: 'One or more rewards have expired' };
      }
      if (coupon.status === CouponStatus.REDEEMED) {
        return {
          success: false,
          message: 'One or more rewards were already redeemed',
        };
      }
      if (coupon.status !== CouponStatus.ACTIVE) {
        return { success: false, message: 'One or more rewards are not active' };
      }
    }

    const redeemedAt = new Date();
    const primaryCoupon = coupons[0];

    return this.dataSource.transaction(async (manager) => {
      for (const coupon of coupons) {
        const updateResult = await manager.update(
          Coupon,
          { id: coupon.id, status: CouponStatus.ACTIVE },
          { status: CouponStatus.REDEEMED, redeemedAt },
        );

        if (!updateResult.affected) {
          return {
            success: false,
            message: 'One or more rewards were already redeemed',
          } as ScanResult;
        }

        await manager.save(RedemptionLog, {
          couponId: coupon.id,
          customerId: coupon.customerId,
          campaignId: coupon.campaignId,
          restaurantId,
          scannedBy,
          scannedAt: redeemedAt,
          deviceInfo: deviceInfo ?? null,
          success: true,
          failureReason: null,
        });
      }

      await manager.save(CustomerVisit, {
        customerId: primaryCoupon.customerId,
        campaignId: primaryCoupon.campaignId,
        restaurantId,
        couponId: primaryCoupon.id,
        staffUserId: scannedBy,
        visitedAt: redeemedAt,
        source: CustomerVisitSource.QR_REDEMPTION,
        orderSubtotal: orderSubtotal ?? null,
      });

      const customerName =
        primaryCoupon.customer?.name?.trim() || 'Guest';
      const campaignName =
        coupons.length === 1
          ? primaryCoupon.campaign?.campaignName?.trim() || 'Campaign'
          : `${coupons.length} rewards`;

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
    });
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
      where: { customerId, restaurantId, paymentStatus: CouponPaymentStatus.PAID },
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
      relations: ['campaign'],
      order: { issuedAt: 'ASC' },
    });

    return coupons
      .filter((coupon) => !this.couponService.isExpired(coupon))
      .map((coupon) => {
        const offer =
          coupon.campaign?.offer?.trim() ||
          coupon.campaign?.campaignName?.trim() ||
          'Reward';
        const isPrepaid = coupon.paymentStatus === CouponPaymentStatus.PAID;
        const paymentLabel = isPrepaid ? 'PREPAID' : 'UNPAID';

        return {
          couponId: coupon.id,
          label: `${offer} [${paymentLabel}]`,
          paymentLabel,
          isScannedCoupon: coupon.id === scannedCouponId,
          canSelect: isPrepaid,
        };
      });
  }

  private async logFailure(
    coupon: Coupon | null,
    restaurantId: number,
    scannedBy: number | null,
    deviceInfo: string | undefined,
    reason: string,
  ): Promise<void> {
    await this.redemptionLogRepository.save({
      couponId: coupon?.id ?? null,
      customerId: coupon?.customerId ?? null,
      campaignId: coupon?.campaignId ?? null,
      restaurantId,
      scannedBy,
      scannedAt: new Date(),
      deviceInfo: deviceInfo ?? null,
      success: false,
      failureReason: reason,
    });
  }
}
