import {
  FunnelCollectionChannel,
  FunnelPayment,
  FunnelPaymentSource,
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

  if (payment.paymentSource === FunnelPaymentSource.SCANNER) {
    return false;
  }
  if (payment.collectionChannel === FunnelCollectionChannel.IN_STORE) {
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
  return false;
}

export function resolveGuestDealPaymentBadge(params: {
  couponPaid: boolean;
  payment: FunnelPayment | null | undefined;
}): GuestDealPaymentBadge {
  if (!params.couponPaid) {
    return 'PENDING';
  }
  if (isScannerFunnelPayment(params.payment)) {
    return 'PAID_AT_COUNTER';
  }
  if (isOnlineFunnelPayment(params.payment)) {
    return 'PAID_ONLINE';
  }
  return 'PAID_AT_COUNTER';
}
