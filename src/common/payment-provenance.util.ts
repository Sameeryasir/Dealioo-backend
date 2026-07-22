import {
  FunnelCollectionChannel,
  FunnelPayment,
  FunnelPaymentSource,
  FunnelPaymentStatus,
} from '../db/entities/funnel-payment.entity';

export type GuestDealPaymentBadge =
  | 'PAID_ONLINE'
  | 'PAID_AT_COUNTER'
  | 'PENDING';

export function isOnlineFunnelPayment(
  payment: FunnelPayment | null | undefined,
): boolean {
  if (!payment) {
    return false;
  }
  if (payment.paymentSource === FunnelPaymentSource.STRIPE) {
    return true;
  }
  if (payment.collectionChannel === FunnelCollectionChannel.ONLINE) {
    return true;
  }
  return (
    Boolean(payment.stripePaymentIntentId?.trim()) ||
    Boolean(payment.stripeCheckoutSessionId?.trim())
  );
}

export function isScannerFunnelPayment(
  payment: FunnelPayment | null | undefined,
): boolean {
  if (!payment) {
    return false;
  }
  if (payment.paymentSource === FunnelPaymentSource.SCANNER) {
    return true;
  }
  if (payment.collectionChannel === FunnelCollectionChannel.IN_STORE) {
    return true;
  }
  return (
    payment.status === FunnelPaymentStatus.PAID && !isOnlineFunnelPayment(payment)
  );
}

export function resolveGuestDealPaymentBadge(params: {
  couponPaid: boolean;
  payment: FunnelPayment | null | undefined;
}): GuestDealPaymentBadge {
  if (!params.couponPaid) {
    return 'PENDING';
  }
  if (isOnlineFunnelPayment(params.payment)) {
    return 'PAID_ONLINE';
  }
  if (isScannerFunnelPayment(params.payment)) {
    return 'PAID_AT_COUNTER';
  }
  return isOnlineFunnelPayment(params.payment)
    ? 'PAID_ONLINE'
    : 'PAID_AT_COUNTER';
}
