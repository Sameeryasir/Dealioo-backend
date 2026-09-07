import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { FunnelPaymentStatus } from '../../db/entities/funnel-payment.entity';
import { visitAddOnAmountDollars } from '../../utils/normalize-extra-items';

export type BusinessOrderPaymentStatus =
  | 'not_paid'
  | 'paid_online'
  | 'paid_walk_in'
  | 'paid_both';

export type BusinessVisitSnapshot = {
  visitId?: number;
  orderSubtotal: number | null;
  visitedAt: Date;
  extraItems?: Array<{ name: string; unitPrice: number; qty: number }>;
};

export type BusinessOrderPaymentSummary = {
  orderStatus: BusinessOrderPaymentStatus;
  onlineAmountCents: number | null;
  businessAmount: number | null;
  businessVisitedAt: Date | null;
  extraItems?: Array<{ name: string; unitPrice: number; qty: number }>;
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

/**
 * True when a scanner order is only counter add-ons (not the campaign offer).
 * Used so Offer amount and Add-on amount do not both show the same dollars.
 */
export function isCounterExtrasOnlyScannerPayment(input: {
  onlineAmountCents: number | null | undefined;
  businessAmountDollars: number | null | undefined;
  paymentSource?: string | null;
  collectionChannel?: string | null;
  orderSource?: string | null;
}): boolean {
  const online =
    input.onlineAmountCents != null && Number.isFinite(input.onlineAmountCents)
      ? Math.round(input.onlineAmountCents)
      : 0;
  const businessDollars =
    input.businessAmountDollars != null &&
    Number.isFinite(input.businessAmountDollars)
      ? Number(input.businessAmountDollars)
      : 0;
  const businessCents = Math.round(businessDollars * 100);
  if (online <= 0 || businessCents <= 0) {
    return false;
  }
  if (Math.abs(online - businessCents) > 1) {
    return false;
  }
  const scannerPayment =
    input.paymentSource === 'SCANNER' ||
    input.collectionChannel === 'IN_STORE';
  const scannerOrder =
    input.orderSource == null || input.orderSource === 'SCANNER';
  return scannerPayment && scannerOrder;
}

export function buildBusinessOrderPaymentSummary(
  event: Pick<FunnelEvent, 'eventType' | 'amount' | 'paymentStatus'>,
  visit: BusinessVisitSnapshot | null,
  options: {
    paidAt?: Date | null;
    livePaymentStatus?: string | null;
    paymentSource?: string | null;
    collectionChannel?: string | null;
    orderSource?: string | null;
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

  const rawOnlineAmountCents =
    event.eventType === FunnelEventType.PAYMENT &&
    event.amount != null &&
    paidOnline
      ? event.amount
      : null;
  const businessAmount = attachVisitToRow
    ? visitAddOnAmountDollars({
        orderSubtotal: visit?.orderSubtotal ?? null,
        extraItems: visit?.extraItems ?? null,
      })
    : null;

  const counterExtrasOnly = isCounterExtrasOnlyScannerPayment({
    onlineAmountCents: rawOnlineAmountCents,
    businessAmountDollars: businessAmount,
    paymentSource: options.paymentSource,
    collectionChannel: options.collectionChannel,
    orderSource: options.orderSource,
  });

  const onlineAmountCents = counterExtrasOnly ? null : rawOnlineAmountCents;

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
    extraItems:
      attachVisitToRow && hasBusiness && visit?.extraItems?.length
        ? visit.extraItems
        : undefined,
  };
}
