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

  if (paymentStatus === 'pending') {
    return 'pending';
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

function businessOrderCheckoutGroupKey(row: {
  id?: number;
  rowKey?: string;
  customer?: { id: number } | null;
  paymentCollectedAt?: Date | string | null;
  funnelPaymentId?: number | null;
  orderId?: number | null;
}): string {
  if (row.orderId != null && row.orderId > 0) {
    return `order:${row.orderId}`;
  }

  const customerId = row.customer?.id;
  const collectedAtMs =
    row.paymentCollectedAt != null
      ? new Date(row.paymentCollectedAt).getTime()
      : NaN;

  if (customerId != null && Number.isFinite(collectedAtMs)) {
    return `checkout:${customerId}:${collectedAtMs}`;
  }

  if (row.funnelPaymentId != null) {
    return `payment:${row.funnelPaymentId}`;
  }

  return row.rowKey ?? `orphan:${row.id ?? 'unknown'}`;
}

/** Campaign / payment price only (cents). Ignores visit extras. */
function businessOrderCampaignPriceCents(row: {
  onlineAmountCents?: number | null;
  amount?: number | null;
}): number {
  if (row.onlineAmountCents != null && row.onlineAmountCents > 0) {
    return row.onlineAmountCents;
  }
  if (row.amount != null && row.amount > 0) {
    return row.amount;
  }
  return 0;
}

/** Visit order_subtotal in dollars (deal + anything else). */
function businessOrderVisitNetDollars(row: {
  businessAmount?: number | null;
}): number {
  if (row.businessAmount != null && Number(row.businessAmount) > 0) {
    return Number(row.businessAmount);
  }
  return 0;
}

function pickBetterOrderStatus(
  current: BusinessOrderPaymentStatus,
  next: BusinessOrderPaymentStatus,
): BusinessOrderPaymentStatus {
  const rank: Record<BusinessOrderPaymentStatus, number> = {
    not_paid: 0,
    paid_walk_in: 1,
    paid_online: 1,
    paid_both: 2,
  };
  return rank[next] > rank[current] ? next : current;
}

function latestDate(
  left: Date | string | null | undefined,
  right: Date | string | null | undefined,
): Date | string | null {
  const leftMs = left != null ? new Date(left).getTime() : NaN;
  const rightMs = right != null ? new Date(right).getTime() : NaN;
  if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) {
    return null;
  }
  if (!Number.isFinite(leftMs)) {
    return right ?? null;
  }
  if (!Number.isFinite(rightMs)) {
    return left ?? null;
  }
  return rightMs >= leftMs ? (right ?? null) : (left ?? null);
}

/** One Orders row per checkout batch (multi-funnel same collect time). */
export function mergeBusinessOrderRowsByCheckout<
  T extends {
    id: number;
    rowKey?: string;
    eventType: string;
    createdAt: Date | string;
    funnelId: number;
    campaignId: number;
    campaignName: string;
    customer?: { id: number; name?: string; email?: string; phone?: string | null } | null;
    customerEmail?: string | null;
    amount?: number | null;
    currency?: string | null;
    paymentStatus?: string | null;
    receiptUrl?: string | null;
    orderStatus: BusinessOrderPaymentStatus;
    onlineAmountCents?: number | null;
    businessAmount?: number | null;
    businessVisitedAt?: Date | string | null;
    paidAt?: Date | string | null;
    funnelPaymentId?: number | null;
    paymentCollectedAt?: Date | string | null;
    orderId?: number | null;
  },
>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = businessOrderCheckoutGroupKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
      continue;
    }
    groups.set(key, [row]);
  }

  const merged: T[] = [];

  for (const [groupKey, groupRows] of groups) {
    if (groupRows.length === 1) {
      const only = groupRows[0];
      merged.push({
        ...only,
        rowKey: groupKey.startsWith('orphan:')
          ? (only.rowKey ?? groupKey)
          : groupKey,
      });
      continue;
    }

    const sorted = [...groupRows].sort(
      (left, right) =>
        resolveBusinessEventPaymentSortDate(right) -
        resolveBusinessEventPaymentSortDate(left),
    );
    const primary = sorted[0];
    let totalCampaignCents = 0;
    let totalVisitNetDollars = 0;
    let orderStatus: BusinessOrderPaymentStatus = 'not_paid';
    let paymentStatus: string | null = primary.paymentStatus ?? null;
    let paidAt: Date | string | null = primary.paidAt ?? null;
    let businessVisitedAt: Date | string | null =
      primary.businessVisitedAt ?? null;
    let createdAt: Date | string = primary.createdAt;
    let paymentCollectedAt: Date | string | null =
      primary.paymentCollectedAt ?? null;
    const campaignNames: string[] = [];
    const seenCampaignNames = new Set<string>();

    for (const row of sorted) {
      totalCampaignCents += businessOrderCampaignPriceCents(row);
      totalVisitNetDollars += businessOrderVisitNetDollars(row);
      orderStatus = pickBetterOrderStatus(orderStatus, row.orderStatus);
      paidAt = latestDate(paidAt, row.paidAt);
      businessVisitedAt = latestDate(
        businessVisitedAt,
        row.businessVisitedAt,
      );
      createdAt = latestDate(createdAt, row.createdAt) ?? createdAt;
      paymentCollectedAt = latestDate(
        paymentCollectedAt,
        row.paymentCollectedAt,
      );

      const status = (row.paymentStatus ?? '').toLowerCase();
      if (status === 'paid') {
        paymentStatus = row.paymentStatus ?? 'paid';
      } else if (paymentStatus == null) {
        paymentStatus = row.paymentStatus ?? null;
      }

      const campaignName = row.campaignName?.trim();
      if (campaignName && !seenCampaignNames.has(campaignName.toLowerCase())) {
        seenCampaignNames.add(campaignName.toLowerCase());
        campaignNames.push(campaignName);
      }
    }

    merged.push({
      ...primary,
      rowKey: groupKey,
      createdAt,
      campaignName: campaignNames.join(', ') || primary.campaignName,
      amount: totalCampaignCents > 0 ? totalCampaignCents : primary.amount,
      paymentStatus,
      orderStatus,
      onlineAmountCents: totalCampaignCents > 0 ? totalCampaignCents : null,
      businessAmount:
        totalVisitNetDollars > 0
          ? Math.round(totalVisitNetDollars * 100) / 100
          : null,
      businessVisitedAt,
      paidAt,
      paymentCollectedAt,
    });
  }

  return merged;
}

/** @deprecated Use mergeBusinessOrderRowsByCheckout */
export function mergeBusinessOrderRowsByCustomer<
  T extends {
    id: number;
    rowKey?: string;
    eventType: string;
    createdAt: Date | string;
    funnelId: number;
    campaignId: number;
    campaignName: string;
    customer?: { id: number; name?: string; email?: string; phone?: string | null } | null;
    customerEmail?: string | null;
    amount?: number | null;
    currency?: string | null;
    paymentStatus?: string | null;
    receiptUrl?: string | null;
    orderStatus: BusinessOrderPaymentStatus;
    onlineAmountCents?: number | null;
    businessAmount?: number | null;
    businessVisitedAt?: Date | string | null;
    paidAt?: Date | string | null;
    funnelPaymentId?: number | null;
    paymentCollectedAt?: Date | string | null;
  },
>(rows: T[]): T[] {
  return mergeBusinessOrderRowsByCheckout(rows);
}
