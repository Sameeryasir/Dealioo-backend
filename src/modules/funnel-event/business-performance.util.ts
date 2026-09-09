import { Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import {
  FunnelCollectionChannel,
  FunnelPayment,
  FunnelPaymentSource,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';

export function shiftUtcByMonths(date: Date, monthDelta: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + monthDelta;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();

  const shifted = new Date(
    Date.UTC(year, monthIndex, 1, hours, minutes, seconds, ms),
  );
  const lastDayOfMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDayOfMonth));
  return shifted;
}

export function resolvePerformancePreviousWindow(
  from: Date,
  to: Date,
): { previousFrom: Date; previousTo: Date } | null {
  const durationMs = to.getTime() - from.getTime();
  if (durationMs <= 0) {
    return null;
  }

  const isSingleCalendarMonth =
    from.getUTCDate() === 1 &&
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth();

  if (isSingleCalendarMonth) {
    const previousFrom = shiftUtcByMonths(from, -1);
    let previousTo = shiftUtcByMonths(to, -1);
    if (previousTo.getTime() < previousFrom.getTime()) {
      previousTo = new Date(previousFrom.getTime());
    }
    return { previousFrom, previousTo };
  }

  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - durationMs);
  return { previousFrom, previousTo };
}

export const PERFORMANCE_VISIT_ADDON_CENTS_SQL = `(
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM visit_addon_items vai
      WHERE vai.customer_visit_id = v.id
    )
    THEN (
      SELECT COALESCE(SUM(vai.line_total_cents), 0)
      FROM visit_addon_items vai
      WHERE vai.customer_visit_id = v.id
    )
    WHEN v.extra_items IS NOT NULL
      AND jsonb_typeof(v.extra_items) = 'array'
      AND jsonb_array_length(v.extra_items) > 0
    THEN (
      SELECT COALESCE(SUM(
        ROUND(COALESCE(
          NULLIF(elem->>'unitPriceCents', '')::numeric,
          CASE
            WHEN NULLIF(elem->>'unitPrice', '') IS NOT NULL
              THEN (elem->>'unitPrice')::numeric * 100
            WHEN NULLIF(elem->>'price', '') IS NOT NULL
              THEN (elem->>'price')::numeric * 100
            ELSE 0
          END,
          0
        ))
        * GREATEST(1, ROUND(COALESCE((elem->>'qty')::numeric, 1)))
      ), 0)
      FROM jsonb_array_elements(v.extra_items) AS elem
    )
    WHEN v.order_subtotal IS NOT NULL
      AND (v.order_subtotal::numeric) > 0
    THEN ROUND((v.order_subtotal::numeric) * 100)
    ELSE 0
  END
)`;

export function applyPerformanceCampaignEarningsFilters(
  qb: ReturnType<Repository<FunnelPayment>['createQueryBuilder']>,
  params: {
    businessId: number;
    from?: Date | null;
    to?: Date | null;
  },
): ReturnType<Repository<FunnelPayment>['createQueryBuilder']> {
  qb.innerJoin(
    Campaign,
    'c',
    'c.id = p.campaign_id AND c.business_id = :businessId AND c.deleted_at IS NULL',
    { businessId: params.businessId },
  )
    .where('p.business_id = :businessId', { businessId: params.businessId })
    .andWhere('p.status = :paid', { paid: FunnelPaymentStatus.PAID })
    .andWhere('p.campaign_id IS NOT NULL')
    .andWhere(
      `NOT EXISTS (
        SELECT 1
        FROM activity_event ae
        WHERE ae.business_id = :businessId
          AND ae.metadata->>'counterExtrasOnly' = 'true'
          AND NULLIF(ae.metadata->>'funnelPaymentId', '') IS NOT NULL
          AND (ae.metadata->>'funnelPaymentId')::int = p.id
      )`,
    )
    .andWhere(
      `NOT EXISTS (
        SELECT 1
        FROM customer_visits v
        WHERE v.business_id = :businessId
          AND v.deleted_at IS NULL
          AND v.order_id IS NOT NULL
          AND v.order_id = p.order_id
          AND (
            p.payment_source = :scannerSource
            OR p.collection_channel = :inStoreChannel
          )
          AND ${PERFORMANCE_VISIT_ADDON_CENTS_SQL} > 0
          AND ABS(p.amount - ${PERFORMANCE_VISIT_ADDON_CENTS_SQL}) <= 1
      )`,
      {
        scannerSource: FunnelPaymentSource.SCANNER,
        inStoreChannel: FunnelCollectionChannel.IN_STORE,
      },
    );

  if (params.from) {
    qb.andWhere('COALESCE(p.paid_at, p.created_at) >= :from', {
      from: params.from,
    });
  }
  if (params.to) {
    qb.andWhere('COALESCE(p.paid_at, p.created_at) <= :to', { to: params.to });
  }

  return qb;
}
