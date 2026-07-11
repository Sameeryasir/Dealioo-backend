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

  if (event.orderStatus !== 'not_paid') {
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

export function normalizeBusinessFunnelEventSearch(
  search?: string,
): string | undefined {
  const trimmed = search?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
