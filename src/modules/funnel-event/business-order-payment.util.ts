import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { FunnelPaymentStatus } from '../../db/entities/funnel-payment.entity';

export type BusinessOrderPaymentStatus =
  | 'not_paid'
  | 'paid_online'
  | 'paid_walk_in'
  | 'paid_both';

export type BusinessVisitSnapshot = {
  orderSubtotal: number;
  visitedAt: Date;
};

export type BusinessOrderPaymentSummary = {
  orderStatus: BusinessOrderPaymentStatus;
  onlineAmountCents: number | null;
  businessAmount: number | null;
  businessVisitedAt: Date | null;
};

export function customerFunnelVisitKey(
  customerId: number,
  funnelId: number,
): string {
  return `${customerId}:${funnelId}`;
}

export function isConfirmedOnlinePayment(input: {
  paymentStatus?: string | null;
  paidAt?: Date | string | null;
}): boolean {
  return (
    input.paymentStatus === FunnelPaymentStatus.PAID ||
    input.paidAt != null
  );
}

export function buildBusinessOrderPaymentSummary(
  event: Pick<FunnelEvent, 'eventType' | 'amount' | 'paymentStatus'>,
  visit: BusinessVisitSnapshot | null,
  options: { paidAt?: Date | null } = {},
): BusinessOrderPaymentSummary {
  const paidOnline = isConfirmedOnlinePayment({
    paymentStatus: event.paymentStatus,
    paidAt: options.paidAt,
  });

  const onlineAmountCents =
    event.eventType === FunnelEventType.PAYMENT &&
    event.amount != null &&
    paidOnline
      ? event.amount
      : null;
  const businessAmount =
    visit?.orderSubtotal != null ? Number(visit.orderSubtotal) : null;

  const hasOnline = onlineAmountCents != null && onlineAmountCents > 0;
  const hasBusiness = businessAmount != null && businessAmount > 0;

  let orderStatus: BusinessOrderPaymentStatus = 'not_paid';
  if (hasOnline && hasBusiness) {
    orderStatus = 'paid_both';
  } else if (hasOnline) {
    orderStatus = 'paid_online';
  } else if (hasBusiness) {
    orderStatus = 'paid_walk_in';
  }

  return {
    orderStatus,
    onlineAmountCents: hasOnline ? onlineAmountCents : null,
    businessAmount: hasBusiness ? businessAmount : null,
    businessVisitedAt: visit?.visitedAt ?? null,
  };
}
