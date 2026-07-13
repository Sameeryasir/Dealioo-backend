import type { BusinessOrderPaymentStatus } from './business-order-payment.util';
import type { BusinessFunnelEventDateFilter } from './funnelEventDto/get-business-funnel-events-query.dto';

export type BusinessEventDisplayStatus =
  | 'paid'
  | 'pending'
  | 'failed'
  | 'refunded';

export function resolveBusinessEventDisplayStatus(event: {
  paymentStatus: string | null;
  orderStatus: BusinessOrderPaymentStatus;
  paidAt?: Date | string | null;
}): BusinessEventDisplayStatus {
  const paymentStatus = event.paymentStatus?.toLowerCase() ?? null;

  if (
    paymentStatus === 'refunded' ||
    paymentStatus === 'partially_refunded'
  ) {
    return 'refunded';
  }

  if (paymentStatus === 'failed' || paymentStatus === 'cancelled') {
    return 'failed';
  }

  const isPaid =
    paymentStatus === 'paid' ||
    event.paidAt != null ||
    event.orderStatus === 'paid_walk_in' ||
    event.orderStatus === 'paid_both';

  if (isPaid) {
    return 'paid';
  }

  return 'pending';
}

export function matchesBusinessEventStatusFilter(
  displayStatus: BusinessEventDisplayStatus,
  filter: 'all' | 'paid' | 'not_paid',
): boolean {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'paid') {
    return displayStatus === 'paid';
  }

  return displayStatus === 'pending';
}

export function getBusinessFunnelEventDateFrom(
  filter: BusinessFunnelEventDateFilter = 'all',
): Date | null {
  if (filter === 'all') {
    return null;
  }

  const now = new Date();

  if (filter === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (filter === 'week') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(now.getDate() - now.getDay());
    return start;
  }

  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function matchesBusinessFunnelEventDateFilter(
  event: {
    createdAt: Date | string;
    paidAt?: Date | string | null;
    businessVisitedAt?: Date | string | null;
  },
  filter: BusinessFunnelEventDateFilter = 'all',
): boolean {
  const dateFrom = getBusinessFunnelEventDateFrom(filter);
  if (!dateFrom) {
    return true;
  }

  return (
    resolveBusinessEventPaymentSortDate(event) >= dateFrom.getTime()
  );
}

export function normalizeBusinessFunnelEventSearch(
  search?: string,
): string | undefined {
  const trimmed = search?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Timestamp used to order business funnel events by when money was collected. */
export function resolveBusinessEventPaymentSortDate(event: {
  createdAt: Date | string;
  paidAt?: Date | string | null;
  businessVisitedAt?: Date | string | null;
}): number {
  const paidAt =
    event.paidAt != null ? new Date(event.paidAt).getTime() : null;
  const visitedAt =
    event.businessVisitedAt != null
      ? new Date(event.businessVisitedAt).getTime()
      : null;

  if (paidAt != null && visitedAt != null) {
    return Math.max(paidAt, visitedAt);
  }
  if (paidAt != null) {
    return paidAt;
  }
  if (visitedAt != null) {
    return visitedAt;
  }

  return new Date(event.createdAt).getTime();
}

export function sortBusinessFunnelEventsByPaymentDate<
  T extends {
    createdAt: Date | string;
    paidAt?: Date | string | null;
    businessVisitedAt?: Date | string | null;
  },
>(events: T[]): T[] {
  return [...events].sort(
    (left, right) =>
      resolveBusinessEventPaymentSortDate(right) -
      resolveBusinessEventPaymentSortDate(left),
  );
}
