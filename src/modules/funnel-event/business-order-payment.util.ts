import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';

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

export function buildBusinessOrderPaymentSummary(
  event: Pick<FunnelEvent, 'eventType' | 'amount'>,
  visit: BusinessVisitSnapshot | null,
): BusinessOrderPaymentSummary {
  const onlineAmountCents =
    event.eventType === FunnelEventType.PAYMENT && event.amount != null
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
  } else if (event.eventType === FunnelEventType.PAYMENT) {
    orderStatus = 'paid_online';
  }

  return {
    orderStatus,
    onlineAmountCents: hasOnline ? onlineAmountCents : null,
    businessAmount: hasBusiness ? businessAmount : null,
    businessVisitedAt: visit?.visitedAt ?? null,
  };
}
