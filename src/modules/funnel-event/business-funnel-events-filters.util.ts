import type { BusinessOrderPaymentStatus } from './business-order-payment.util';
import type { BusinessFunnelEventDateFilter } from './funnelEventDto/get-business-funnel-events-query.dto';
import { FunnelEventType } from '../../db/entities/funnel-event.entity';

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

  // Not paid = anything that is not a successful paid order
  return displayStatus !== 'paid';
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

export function resolveBusinessEventPaymentSortDate(event: {
  createdAt: Date | string;
  paidAt?: Date | string | null;
  businessVisitedAt?: Date | string | null;
}): number {
  if (event.paidAt != null) {
    return new Date(event.paidAt).getTime();
  }
  if (event.businessVisitedAt != null) {
    return new Date(event.businessVisitedAt).getTime();
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

/** Hide SIGNUP when a payment exists; keep one row per funnelPaymentId. */
export function dedupeBusinessOrderEventRows<
  T extends {
    eventType: string;
    funnelId: number;
    customer?: { id: number } | null;
    funnelPaymentId?: number | null;
  },
>(rows: T[]): T[] {
  const customerFunnelsWithPayment = new Set<string>();

  for (const row of rows) {
    const customerId = row.customer?.id;
    if (customerId == null) {
      continue;
    }
    if (
      row.eventType === FunnelEventType.PAYMENT ||
      row.funnelPaymentId != null
    ) {
      customerFunnelsWithPayment.add(`${customerId}:${row.funnelId}`);
    }
  }

  const withoutSignupDupes = rows.filter((row) => {
    if (row.eventType !== FunnelEventType.SIGNUP) {
      return true;
    }
    const customerId = row.customer?.id;
    if (customerId == null) {
      return true;
    }
    return !customerFunnelsWithPayment.has(`${customerId}:${row.funnelId}`);
  });

  const seenPaymentIds = new Set<number>();
  return withoutSignupDupes.filter((row) => {
    if (row.funnelPaymentId == null) {
      return true;
    }
    if (seenPaymentIds.has(row.funnelPaymentId)) {
      return false;
    }
    seenPaymentIds.add(row.funnelPaymentId);
    return true;
  });
}
