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
  visitId?: number;
  orderSubtotal: number | null;
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

export function customerCampaignVisitKey(
  customerId: number,
  campaignId: number,
): string {
  return `${customerId}:campaign:${campaignId}`;
}

export function isConfirmedOnlinePayment(input: {
  paymentStatus?: string | null;
  paidAt?: Date | string | null;
  /** Live funnel_payment.status — wins over stale event DTO values. */
  livePaymentStatus?: string | null;
}): boolean {
  const status = input.livePaymentStatus ?? input.paymentStatus;
  return status === FunnelPaymentStatus.PAID;
}

export function buildBusinessOrderPaymentSummary(
  event: Pick<FunnelEvent, 'eventType' | 'amount' | 'paymentStatus'>,
  visit: BusinessVisitSnapshot | null,
  options: {
    paidAt?: Date | null;
    livePaymentStatus?: string | null;
  } = {},
): BusinessOrderPaymentSummary {
  const effectiveStatus = options.livePaymentStatus ?? event.paymentStatus;
  const paidOnline = isConfirmedOnlinePayment({
    paymentStatus: effectiveStatus,
    livePaymentStatus: options.livePaymentStatus,
  });

  // Visit totals belong on the PAYMENT row only.
  // Applying them to SIGNUP makes $12 + "nothing else" look like two Paid orders.
  const attachVisitToRow = event.eventType === FunnelEventType.PAYMENT;

  const onlineAmountCents =
    event.eventType === FunnelEventType.PAYMENT &&
    event.amount != null &&
    paidOnline
      ? event.amount
      : null;
  const businessAmount =
    attachVisitToRow && visit?.orderSubtotal != null
      ? Number(visit.orderSubtotal)
      : null;

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
    businessVisitedAt: attachVisitToRow ? (visit?.visitedAt ?? null) : null,
  };
}
