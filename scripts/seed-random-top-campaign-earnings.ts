/**
 * Shuffle which campaign is "Top Campaign" by randomly scaling paid amounts.
 *
 * Top Campaign = highest sum of paid deal earnings in the selected window.
 * Demo data often keeps the same winner; this script multiplies each campaign's
 * paid amounts by a random factor so ranking changes.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-random-top-campaign-earnings.ts
 *   npx ts-node -r tsconfig-paths/register scripts/seed-random-top-campaign-earnings.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/seed-random-top-campaign-earnings.ts --business-id=2
 *   npx ts-node -r tsconfig-paths/register scripts/seed-random-top-campaign-earnings.ts --months=6
 */
import 'reflect-metadata';
import { config } from 'dotenv';
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

const MIN_FACTOR = 0.35;

type CampaignRow = {
  campaign_id: number;
  campaign_name: string;
  business_id: number;
};

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
        SELECT c.id AS campaign_id, c.campaign_name, c.business_id
        FROM campaigns c
        WHERE c.deleted_at IS NULL
          AND ($1::int IS NULL OR c.business_id = $1)
        ORDER BY c.business_id ASC, c.id ASC
      `,
      [BUSINESS_ID],
    )) as CampaignRow[];

    if (campaigns.length === 0) {
      console.log('No campaigns found.');
      return;
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}Randomizing top-campaign earnings for ${campaigns.length} campaign(s)`,
    );
    console.log(
      `Window: ${from.toISOString()} → ${to.toISOString()} (last ${MONTHS} month(s))`,
    );

    const byBusiness = new Map<number, CampaignRow[]>();
    for (const campaign of campaigns) {
      const list = byBusiness.get(campaign.business_id) ?? [];
      list.push(campaign);
      byBusiness.set(campaign.business_id, list);
    }

    for (const [businessId, businessCampaigns] of byBusiness) {
      console.log(`\nBusiness ${businessId}`);

      const withEarnings: Array<{
        campaign: CampaignRow;
        beforeCents: number;
      }> = [];

      for (const campaign of businessCampaigns) {
        const beforeRows = await qr.manager.query(
          `
            SELECT COALESCE(SUM(GREATEST(0, COALESCE(p.amount, 0) - COALESCE(p.refunded_amount, 0))), 0)::bigint AS earnings_cents
            FROM funnel_payment p
            WHERE p.campaign_id = $1
              AND p.deleted_at IS NULL
              AND p.status IN ('paid', 'partially_refunded')
              AND COALESCE(p.paid_at, p.created_at) >= $2
              AND COALESCE(p.paid_at, p.created_at) <= $3
          `,
          [campaign.campaign_id, from, to],
        );
        const beforeCents = Math.max(
          0,
          Number(beforeRows[0]?.earnings_cents) || 0,
        );
        if (beforeCents > 0) {
          withEarnings.push({ campaign, beforeCents });
        } else {
          console.log(
            `  #${campaign.campaign_id} ${campaign.campaign_name}: $0.00 (skipped)`,
          );
        }
      }

      if (withEarnings.length === 0) {
        console.log('  No paid earnings in this window.');
        continue;
      }

      const winnerIndex = Math.floor(Math.random() * withEarnings.length);
      const winnerId = withEarnings[winnerIndex]!.campaign.campaign_id;
      const maxOther = Math.max(
        ...withEarnings
          .filter((row) => row.campaign.campaign_id !== winnerId)
          .map((row) => row.beforeCents),
        0,
      );

      const projected: Array<{
        campaign: CampaignRow;
        factor: number;
        beforeCents: number;
        afterCents: number;
      }> = [];

      for (const row of withEarnings) {
        const isWinner = row.campaign.campaign_id === winnerId;
        let factor: number;
        if (isWinner) {
          const needCents = Math.max(maxOther * 1.15, row.beforeCents * 1.25);
          factor = Math.max(1.25, needCents / Math.max(row.beforeCents, 1));
          factor *= 1 + Math.random() * 0.35;
        } else {
          factor = MIN_FACTOR + Math.random() * (1.05 - MIN_FACTOR);
        }

        projected.push({
          campaign: row.campaign,
          factor,
          beforeCents: row.beforeCents,
          afterCents: Math.round(row.beforeCents * factor),
        });
      }

      projected.sort((a, b) => b.afterCents - a.afterCents);

      for (const row of projected) {
        const label =
          row.campaign.campaign_id === winnerId ? ' ← top (picked)' : '';
        console.log(
          `  #${row.campaign.campaign_id} ${row.campaign.campaign_name}: $${(row.beforeCents / 100).toFixed(2)} × ${row.factor.toFixed(2)} → $${(row.afterCents / 100).toFixed(2)}${label}`,
        );

        if (DRY_RUN) {
          continue;
        }

        await qr.manager.query(
          `
            UPDATE funnel_payment p
            SET
              amount = GREATEST(
                1,
                ROUND(
                  GREATEST(0, COALESCE(p.amount, 0) - COALESCE(p.refunded_amount, 0)) * ($1::numeric)
                )::int + COALESCE(p.refunded_amount, 0)
              ),
              updated_at = NOW()
            WHERE p.campaign_id = $2
              AND p.deleted_at IS NULL
              AND p.status IN ('paid', 'partially_refunded')
              AND COALESCE(p.paid_at, p.created_at) >= $3
              AND COALESCE(p.paid_at, p.created_at) <= $4
          `,
          [row.factor, row.campaign.campaign_id, from, to],
        );
      }
    }

    console.log(
      DRY_RUN
        ? '\n[dry-run] No rows updated.'
        : '\nDone. Top Campaign ranking should now differ per business.',
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
