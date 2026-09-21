/**
 * Seed random conversion rates by inserting extra funnel page_view events.
 *
 * Conversion rate on Performance = paid orders / distinct views.
 * Local demo data currently has views ≈ orders (~100%). This script adds
 * unique visitor page views so each campaign lands on a random rate.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-random-conversion-rates.ts
 *   npx ts-node -r tsconfig-paths/register scripts/seed-random-conversion-rates.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/seed-random-conversion-rates.ts --business-id=2
 *   npx ts-node -r tsconfig-paths/register scripts/seed-random-conversion-rates.ts --months=6
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import AppDataSource from '../src/data-source';

config();

const DRY_RUN = process.argv.includes('--dry-run');
const businessArg = process.argv.find((arg) => arg.startsWith('--business-id='));
const monthsArg = process.argv.find((arg) => arg.startsWith('--months='));
const BUSINESS_ID = businessArg
  ? Number(businessArg.slice('--business-id='.length))
  : null;
const MONTHS = Math.min(
  24,
  Math.max(1, Number(monthsArg?.slice('--months='.length) ?? 6) || 6),
);

const MIN_RATE = 0.05;
const MAX_RATE = 0.42;
const SEED_TAG = 'seedRandomConversion';

type CampaignRow = {
  campaign_id: number;
  campaign_name: string;
  business_id: number;
  funnel_id: number;
};

function randomRate(): number {
  return MIN_RATE + Math.random() * (MAX_RATE - MIN_RATE);
}

function rangeStartUtc(months: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1, 0, 0, 0, 0),
  );
}

async function main() {
  if (BUSINESS_ID != null && (!Number.isFinite(BUSINESS_ID) || BUSINESS_ID < 1)) {
    throw new Error('Valid --business-id is required when provided.');
  }

  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  const from = rangeStartUtc(MONTHS);
  const to = new Date();

  try {
    const campaigns = (await qr.manager.query(
      `
        SELECT
          c.id AS campaign_id,
          c.campaign_name,
          c.business_id,
          f.id AS funnel_id
        FROM campaigns c
        INNER JOIN funnels f ON f.campaign_id = c.id
        WHERE c.deleted_at IS NULL
          AND ($1::int IS NULL OR c.business_id = $1)
        ORDER BY c.business_id ASC, c.id ASC
      `,
      [BUSINESS_ID],
    )) as CampaignRow[];

    if (campaigns.length === 0) {
      console.log('No campaigns with funnels found.');
      return;
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}Seeding random conversion views for ${campaigns.length} campaign(s)`,
    );
    console.log(
      `Window: ${from.toISOString()} → ${to.toISOString()} (last ${MONTHS} month(s))`,
    );

    let totalInserted = 0;

    for (const campaign of campaigns) {
      const paidRows = await qr.manager.query(
        `
          SELECT COUNT(*)::int AS paid_orders
          FROM funnel_payment p
          WHERE p.campaign_id = $1
            AND p.status IN ('paid', 'partially_refunded')
            AND COALESCE(p.paid_at, p.created_at) >= $2
            AND COALESCE(p.paid_at, p.created_at) <= $3
        `,
        [campaign.campaign_id, from, to],
      );
      const paidOrders = Math.max(0, Number(paidRows[0]?.paid_orders) || 0);

      const viewRows = await qr.manager.query(
        `
          SELECT COUNT(DISTINCT COALESCE(
            NULLIF(ae.visitor_id, ''),
            NULLIF(ae.session_id, ''),
            CONCAT('e:', ae.id::text)
          ))::int AS view_count
          FROM funnel_analytics_event ae
          WHERE ae.funnel_id = $1
            AND ae.event_type = 'page_view'
            AND ae.deleted_at IS NULL
            AND ae.created_at >= $2
            AND ae.created_at <= $3
        `,
        [campaign.funnel_id, from, to],
      );
      const currentViews = Math.max(0, Number(viewRows[0]?.view_count) || 0);

      const targetRate = randomRate();
      const baselineOrders = Math.max(paidOrders, 1);
      const targetViews = Math.max(
        currentViews,
        Math.ceil(baselineOrders / targetRate),
      );
      const extraViews = Math.max(0, targetViews - currentViews);

      const projectedRate =
        currentViews + extraViews > 0
          ? paidOrders / (currentViews + extraViews)
          : 0;

      console.log(
        `  #${campaign.campaign_id} ${campaign.campaign_name}: paid=${paidOrders}, views=${currentViews}, +${extraViews} views → ~${(projectedRate * 100).toFixed(1)}% (target ${(targetRate * 100).toFixed(1)}%)`,
      );

      if (DRY_RUN || extraViews === 0) {
        continue;
      }

      const batchSize = 500;
      let remaining = extraViews;
      while (remaining > 0) {
        const chunk = Math.min(batchSize, remaining);
        const values: unknown[] = [];
        const placeholders: string[] = [];

        for (let i = 0; i < chunk; i += 1) {
          const visitorId = `seed-cv-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          const sessionId = `seed-cv-s-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
          const dayOffset = Math.floor(Math.random() * Math.max(1, MONTHS * 30));
          const createdAt = new Date(to.getTime());
          createdAt.setUTCDate(createdAt.getUTCDate() - dayOffset);
          createdAt.setUTCHours(
            8 + Math.floor(Math.random() * 12),
            Math.floor(Math.random() * 60),
            Math.floor(Math.random() * 60),
            0,
          );
          if (createdAt.getTime() < from.getTime()) {
            createdAt.setTime(from.getTime() + Math.floor(Math.random() * 86_400_000));
          }

          const base = values.length;
          placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, 'page_view', '/landing', 'landing', 1, $${base + 4}::jsonb, $${base + 5})`,
          );
          values.push(
            campaign.funnel_id,
            visitorId,
            sessionId,
            JSON.stringify({
              [SEED_TAG]: true,
              campaignId: campaign.campaign_id,
            }),
            createdAt.toISOString(),
          );
        }

        await qr.manager.query(
          `
            INSERT INTO funnel_analytics_event
              (funnel_id, visitor_id, session_id, event_type, page_path, step_name, step_order, metadata, created_at)
            VALUES ${placeholders.join(', ')}
          `,
          values,
        );

        remaining -= chunk;
        totalInserted += chunk;
      }
    }

    console.log(
      DRY_RUN
        ? '[dry-run] No rows written.'
        : `Done. Inserted ${totalInserted} page_view row(s).`,
    );
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
