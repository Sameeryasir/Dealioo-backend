import { Injectable } from '@nestjs/common';
import {
  Coupon,
  CouponPaymentStatus,
  CouponStatus,
} from '../../db/entities/coupon.entity';
import {
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { CouponService } from './coupon.service';
import {
  ScannerErrorCode,
  ScannerErrorMessage,
  type ScannerErrorCode as ScannerErrorCodeType,
} from './scanner-error-codes';

export type RedemptionValidationOptions = {
  orderSubtotal?: number;
};

export type RedemptionValidationResult = {
  canRedeem: boolean;
  requiresWalkInPayment: boolean;
  redeemBlockedReason: string | null;
  errorCode: ScannerErrorCodeType | null;
  paymentStatus: CouponPaymentStatus;
  couponStatus: CouponStatus;
  couponExpired: boolean;
};

@Injectable()
export class RedemptionValidationService {
  constructor(private readonly couponService: CouponService) {}

  mapFunnelPaymentToCouponStatus(
    status: FunnelPaymentStatus,
  ): CouponPaymentStatus {
    switch (status) {
      case FunnelPaymentStatus.PAID:
        return CouponPaymentStatus.PAID;
      case FunnelPaymentStatus.PENDING:
        return CouponPaymentStatus.PENDING;
      case FunnelPaymentStatus.FAILED:
        return CouponPaymentStatus.FAILED;
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

  paymentBlockedReason(status: CouponPaymentStatus): {
    message: string;
    code: ScannerErrorCodeType;
  } {
    switch (status) {
      case CouponPaymentStatus.PAID:
        return { message: '', code: ScannerErrorCode.PAYMENT_PENDING };
      case CouponPaymentStatus.PENDING:
        return {
          message: ScannerErrorMessage.PAYMENT_PENDING,
          code: ScannerErrorCode.PAYMENT_PENDING,
        };
      case CouponPaymentStatus.FAILED:
        return {
          message: ScannerErrorMessage.PAYMENT_FAILED,
          code: ScannerErrorCode.PAYMENT_FAILED,
        };
      case CouponPaymentStatus.REFUNDED:
        return {
          message: ScannerErrorMessage.PAYMENT_REFUNDED,
          code: ScannerErrorCode.PAYMENT_REFUNDED,
        };
      case CouponPaymentStatus.DISPUTED:
        return {
          message: ScannerErrorMessage.PAYMENT_DISPUTED,
          code: ScannerErrorCode.PAYMENT_DISPUTED,
        };
      default:
        return {
          message: ScannerErrorMessage.PAYMENT_PENDING,
          code: ScannerErrorCode.PAYMENT_PENDING,
        };
    }
  }

  resolveAuthoritativePaymentStatus(coupon: Coupon): {
    couponPaymentStatus: CouponPaymentStatus;
    funnelStatus: FunnelPaymentStatus | null;
    cancelled: boolean;
  } {
    const funnelStatus = coupon.funnelPayment?.status ?? null;
    if (funnelStatus === FunnelPaymentStatus.CANCELLED) {
      return {
        couponPaymentStatus: CouponPaymentStatus.FAILED,
        funnelStatus,
        cancelled: true,
      };
    }
    if (funnelStatus != null) {
      return {
        couponPaymentStatus: this.mapFunnelPaymentToCouponStatus(funnelStatus),
        funnelStatus,
        cancelled: false,
      };
    }
    return {
      couponPaymentStatus: coupon.paymentStatus,
      funnelStatus: null,
      cancelled: false,
    };
  }

  validateCouponForRedemption(
    coupon: Coupon,
    options?: RedemptionValidationOptions,
  ): RedemptionValidationResult {
    const couponExpired = this.couponService.isExpired(coupon);
    const couponStatus = coupon.status;
    const authoritative = this.resolveAuthoritativePaymentStatus(coupon);
    const paymentStatus = authoritative.couponPaymentStatus;

    if (couponExpired) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: ScannerErrorMessage.EXPIRED_COUPON,
        errorCode: ScannerErrorCode.EXPIRED_COUPON,
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (couponStatus === CouponStatus.REDEEMED) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: ScannerErrorMessage.ALREADY_REDEEMED,
        errorCode: ScannerErrorCode.ALREADY_REDEEMED,
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (couponStatus === CouponStatus.REVOKED) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: ScannerErrorMessage.COUPON_REVOKED,
        errorCode: ScannerErrorCode.COUPON_REVOKED,
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (couponStatus !== CouponStatus.ACTIVE) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: ScannerErrorMessage.COUPON_NOT_ACTIVE,
        errorCode: ScannerErrorCode.COUPON_NOT_ACTIVE,
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    if (authoritative.cancelled) {
      return {
        canRedeem: false,
        requiresWalkInPayment: false,
        redeemBlockedReason: ScannerErrorMessage.PAYMENT_CANCELLED,
        errorCode: ScannerErrorCode.PAYMENT_CANCELLED,
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
        errorCode: null,
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
          errorCode: null,
          paymentStatus,
          couponStatus,
          couponExpired,
        };
      }

      return {
        canRedeem: false,
        requiresWalkInPayment: true,
        redeemBlockedReason: ScannerErrorMessage.PAYMENT_PENDING,
        errorCode: ScannerErrorCode.PAYMENT_PENDING,
        paymentStatus,
        couponStatus,
        couponExpired,
      };
    }

    const blocked = this.paymentBlockedReason(paymentStatus);
    return {
      canRedeem: false,
      requiresWalkInPayment: false,
      redeemBlockedReason: blocked.message,
      errorCode: blocked.code,
      paymentStatus,
      couponStatus,
      couponExpired,
    };
  }
}
