export const ScannerErrorCode = {
  ALREADY_REDEEMED: 'ALREADY_REDEEMED',
  EXPIRED_COUPON: 'EXPIRED_COUPON',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  PAYMENT_DISPUTED: 'PAYMENT_DISPUTED',
  COUPON_NOT_FOUND: 'COUPON_NOT_FOUND',
  WRONG_BUSINESS: 'WRONG_BUSINESS',
  DUPLICATE_PURCHASE: 'DUPLICATE_PURCHASE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  MIXED_PAYMENT_TYPES: 'MIXED_PAYMENT_TYPES',
  COUPON_REVOKED: 'COUPON_REVOKED',
  COUPON_NOT_ACTIVE: 'COUPON_NOT_ACTIVE',
  INVALID_SELECTION: 'INVALID_SELECTION',
  CAMPAIGN_INACTIVE: 'CAMPAIGN_INACTIVE',
} as const;

export type ScannerErrorCode =
  (typeof ScannerErrorCode)[keyof typeof ScannerErrorCode];

export const ScannerErrorMessage: Record<ScannerErrorCode, string> = {
  ALREADY_REDEEMED: 'Already Redeemed',
  EXPIRED_COUPON: 'Expired Coupon',
  PAYMENT_PENDING: 'Payment Pending',
  PAYMENT_CANCELLED: 'Payment Cancelled',
  PAYMENT_FAILED: 'Payment Failed',
  PAYMENT_REFUNDED: 'Payment Refunded',
  PAYMENT_DISPUTED: 'Payment Disputed',
  COUPON_NOT_FOUND: 'Coupon Not Found',
  WRONG_BUSINESS: 'Wrong Business',
  DUPLICATE_PURCHASE: 'Duplicate Purchase',
  INVALID_AMOUNT: 'Invalid Amount',
  MIXED_PAYMENT_TYPES: 'Redeem prepaid and unpaid offers separately',
  COUPON_REVOKED: 'This pass was replaced by a newer one',
  COUPON_NOT_ACTIVE: 'Coupon is not active',
  INVALID_SELECTION: 'Invalid reward selection',
  CAMPAIGN_INACTIVE: 'This deal is no longer available',
};
