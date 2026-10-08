import type { EntityManager } from 'typeorm';
import { hashExternalIdForMeta } from '../product-meta-tracking/product-meta-hash.util';

export type GuestAdAttributionSource = 'meta' | 'google' | 'utm';

export type GuestAdAttribution = {
  source: GuestAdAttributionSource;
  label: string;
  detail: string | null;
};

function normalizeUtm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function attributionFromUtm(params: {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}): GuestAdAttribution | null {
  const source = normalizeUtm(params.utmSource);
  const medium = normalizeUtm(params.utmMedium);
  const campaign = (params.utmCampaign ?? '').trim() || null;
  if (!source && !medium) return null;

  const blob = `${source} ${medium}`;
  if (
    blob.includes('facebook') ||
    blob.includes('fb') ||
    blob.includes('instagram') ||
    blob.includes('meta')
  ) {
    return {
      source: 'meta',
      label: 'Facebook',
      detail: campaign,
    };
  }
  if (blob.includes('google') || blob.includes('gclid') || medium === 'cpc') {
    return {
      source: 'google',
      label: 'Google',
      detail: campaign,
    };
  }

  const labelSource = params.utmSource?.trim() || params.utmMedium?.trim() || 'Ad';
  return {
    source: 'utm',
    label: labelSource,
    detail: campaign,
  };
}

export async function resolveGuestAdAttributions(
  manager: EntityManager,
  params: {
    businessId: number;
    customerIds: number[];
    funnelId?: number | null;
  },
): Promise<Map<number, GuestAdAttribution>> {
  const result = new Map<number, GuestAdAttribution>();
  const customerIds = [
    ...new Set(
      params.customerIds.filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (customerIds.length === 0) return result;

  const hashToCustomerId = new Map<string, number>();
  for (const customerId of customerIds) {
    const hash = hashExternalIdForMeta(String(customerId));
    if (hash) hashToCustomerId.set(hash, customerId);
  }
  const hashes = [...hashToCustomerId.keys()];

  if (hashes.length > 0) {
    const metaRows: Array<{ externalId: string }> = await manager.query(
      `
        SELECT DISTINCT ON (eid.val)
          eid.val AS "externalId"
        FROM meta_funnel_events m
        CROSS JOIN LATERAL jsonb_array_elements_text(
          COALESCE(m.user_data->'external_id', '[]'::jsonb)
        ) AS eid(val)
        WHERE m.business_id = $1
          AND (m.fbclid IS NOT NULL OR m.fbc IS NOT NULL)
          AND eid.val = ANY($2::text[])
          ${params.funnelId != null && params.funnelId > 0 ? 'AND (m.funnel_id IS NULL OR m.funnel_id = $3)' : ''}
        ORDER BY eid.val, m.created_at ASC
      `,
      params.funnelId != null && params.funnelId > 0
        ? [params.businessId, hashes, params.funnelId]
        : [params.businessId, hashes],
    );

    for (const row of metaRows) {
      const customerId = hashToCustomerId.get(String(row.externalId));
      if (customerId == null || result.has(customerId)) continue;
      result.set(customerId, {
        source: 'meta',
        label: 'Facebook',
        detail: null,
      });
    }
  }

  const remainingAfterMeta = customerIds.filter((id) => !result.has(id));
  if (remainingAfterMeta.length === 0) return result;

  const googleRows: Array<{ customerId: string }> = await manager.query(
    `
      SELECT DISTINCT fe.customer_id AS "customerId"
      FROM funnel_event fe
      INNER JOIN google_funnel_events g
        ON g.business_id = $1
       AND g.gclid IS NOT NULL
       AND (g.funnel_id IS NULL OR g.funnel_id = fe.funnel_id)
      WHERE fe.customer_id = ANY($2::int[])
        AND fe.customer_id IS NOT NULL
        ${params.funnelId != null && params.funnelId > 0 ? 'AND fe.funnel_id = $3' : ''}
    `,
    params.funnelId != null && params.funnelId > 0
      ? [params.businessId, remainingAfterMeta, params.funnelId]
      : [params.businessId, remainingAfterMeta],
  );

  for (const row of googleRows) {
    const customerId = Number(row.customerId);
    if (!Number.isFinite(customerId) || result.has(customerId)) continue;
    result.set(customerId, {
      source: 'google',
      label: 'Google',
      detail: null,
    });
  }

  const remainingAfterGoogle = customerIds.filter((id) => !result.has(id));
  if (remainingAfterGoogle.length === 0) return result;

  const utmRows: Array<{
    customerId: string;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
  }> = await manager.query(
    `
      SELECT DISTINCT ON (a.customer_id)
        a.customer_id AS "customerId",
        a.utm_source AS "utmSource",
        a.utm_medium AS "utmMedium",
        a.utm_campaign AS "utmCampaign"
      FROM funnel_analytics_event a
      WHERE a.customer_id = ANY($1::int[])
        AND a.deleted_at IS NULL
        AND (
          (a.utm_source IS NOT NULL AND btrim(a.utm_source) <> '')
          OR (a.utm_medium IS NOT NULL AND btrim(a.utm_medium) <> '')
        )
        ${params.funnelId != null && params.funnelId > 0 ? 'AND a.funnel_id = $2' : ''}
      ORDER BY a.customer_id, a.created_at ASC
    `,
    params.funnelId != null && params.funnelId > 0
      ? [remainingAfterGoogle, params.funnelId]
      : [remainingAfterGoogle],
  );

  for (const row of utmRows) {
    const customerId = Number(row.customerId);
    if (!Number.isFinite(customerId) || result.has(customerId)) continue;
    const attribution = attributionFromUtm({
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
    });
    if (attribution) {
      result.set(customerId, attribution);
    }
  }

  return result;
}
