import { Injectable } from '@nestjs/common';
import {
  Coupon,
  CouponPaymentStatus,
  CouponStatus,
} from '../../db/entities/coupon.entity';
import { FunnelPaymentStatus } from '../../db/entities/funnel-payment.entity';
import { CouponService } from './coupon.service';

export type RedemptionValidationOptions = {
  /** Order subtotal entered by staff at the business (walk-in payment). */
  orderSubtotal?: number;
};

export type RedemptionValidationResult = {
  canRedeem: boolean;
  /** Unpaid signup — staff must enter order amount before redeem completes. */
  requiresWalkInPayment: boolean;
  redeemBlockedReason: string | null;
  paymentStatus: CouponPaymentStatus;
  couponStatus: CouponStatus;
  couponExpired: boolean;
};

@Injectable()
export class RedemptionValidationService {
  constructor(private readonly couponService: CouponService) {}

  /** Map live funnel payment status onto coupon payment status for scanner display. */
  mapFunnelPaymentToCouponStatus(
    status: FunnelPaymentStatus,
  ): CouponPaymentStatus {
    switch (status) {
      case FunnelPaymentStatus.PAID:
        return CouponPaymentStatus.PAID;
      case FunnelPaymentStatus.PENDING:
        return CouponPaymentStatus.PENDING;
      case FunnelPaymentStatus.FAILED:
      case FunnelPaymentStatus.CANCELLED:
        return CouponPaymentStatus.FAILED;
      case FunnelPaymentStatus.REFUNDED:
      case FunnelPaymentStatus.PARTIALLY_REFUNDED:
        return CouponPaymentStatus.REFUNDED;
      case FunnelPaymentStatus.DISPUTED:
        return CouponPaymentStatus.DISPUTED;
      default:
        return CouponPaymentStatus.PENDING;
    }
  }

  paymentBlockedReason(status: CouponPaymentStatus): string | null {
    switch (status) {
      case CouponPaymentStatus.PAID:
        return null;
      case CouponPaymentStatus.PENDING:
        return 'Payment not completed';
      case CouponPaymentStatus.FAILED:
        return 'Payment failed';
      case CouponPaymentStatus.REFUNDED:
        return 'Payment refunded';
      case CouponPaymentStatus.DISPUTED:
        return 'Payment disputed';
      default:
        return 'Payment not completed';
    }
  }

  /** Shared server-side checks for preview and redeem — never trust the frontend. */
  validateCouponForRedemption(
    coupon: Coupon,
    options?: RedemptionValidationOptions,
  ): RedemptionValidationResult {
    const couponExpired = this.couponService.isExpired(coupon);
    const paymentStatus = coupon.paymentStatus;
    const couponStatus = coupon.status;

    if (couponExpired) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: 'Coupon expired',
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (couponStatus === CouponStatus.REDEEMED) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: 'Coupon already redeemed',
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (couponStatus === CouponStatus.REVOKED) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: 'This pass was replaced by a newer one',
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (couponStatus !== CouponStatus.ACTIVE) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: 'Coupon is not active',
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (paymentStatus === CouponPaymentStatus.PAID) {
      return {
        canRedeem: true,
        requiresWalkInPayment: false,
        redeemBlockedReason: null,
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (paymentStatus === CouponPaymentStatus.PENDING) {
      const walkInAmount = options?.orderSubtotal;
      const hasWalkInPayment =
        walkInAmount != null && Number.isFinite(walkInAmount) && walkInAmount > 0;

      if (hasWalkInPayment) {
        return {
          canRedeem: true,
          requiresWalkInPayment: true,
          redeemBlockedReason: null,
          paymentStatus,
          couponStatus,
          couponExpired,
        };
      }

      return {
        canRedeem: false,
        requiresWalkInPayment: true,
        redeemBlockedReason:
          'Guest has not paid online — enter order amount to redeem',
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    return {
      canRedeem: false,
      requiresWalkInPayment: false,
      redeemBlockedReason: this.paymentBlockedReason(paymentStatus),
      paymentStatus,
      couponStatus,
      couponExpired,
    };
  }
}
