import 'reflect-metadata';
import { createHash, randomBytes } from 'crypto';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';

config();

const DRY_RUN = process.argv.includes('--dry-run');
const businessArg = process.argv.find((arg) => arg.startsWith('--business-id='));
const campaignArg = process.argv.find((arg) => arg.startsWith('--campaign-id='));
const BUSINESS_ID = businessArg
  ? Number(businessArg.slice('--business-id='.length))
  : null;
const CAMPAIGN_ID = campaignArg
  ? Number(campaignArg.slice('--campaign-id='.length))
  : null;
const PER_CAMPAIGN_LIMIT = 12;

const SAMPLE_COMMENTS = [
  'Great experience overall. Would recommend to friends.',
  'Smooth signup and friendly staff. Loved the offer.',
  'Solid campaign — clear value and easy checkout.',
  'Really enjoyed it. Coming back soon.',
  'Good quality and fast service.',
  'Nice deal. Communication could be a bit clearer.',
  'Fantastic! Exactly what I expected.',
  'Worth it. The pass was easy to use.',
];

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function pickComment(index: number): string | null {
  if (index % 5 === 0) return null;
  return SAMPLE_COMMENTS[index % SAMPLE_COMMENTS.length] ?? SAMPLE_COMMENTS[0];
}

function pickRating(index: number): number {
  const ratings = [5, 5, 4, 5, 3, 4, 5, 4];
  return ratings[index % ratings.length] ?? 5;
}

async function main() {
  if (BUSINESS_ID != null && (!Number.isFinite(BUSINESS_ID) || BUSINESS_ID < 1)) {
    throw new Error('Valid --business-id is required when provided.');
  }
  if (CAMPAIGN_ID != null && (!Number.isFinite(CAMPAIGN_ID) || CAMPAIGN_ID < 1)) {
    throw new Error('Valid --campaign-id is required when provided.');
  }

  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();

  try {
    const campaigns = (await qr.manager.query(
      `
        SELECT
          c.id AS campaign_id,
          c.business_id,
          c.campaign_name,
          f.id AS funnel_id
        FROM campaigns c
        LEFT JOIN funnels f ON f.campaign_id = c.id AND f.deleted_at IS NULL
        WHERE c.deleted_at IS NULL
          AND ($1::int IS NULL OR c.business_id = $1)
          AND ($2::int IS NULL OR c.id = $2)
        ORDER BY c.id ASC
      `,
      [BUSINESS_ID, CAMPAIGN_ID],
    )) as Array<{
      campaign_id: number;
      business_id: number;
      campaign_name: string;
      funnel_id: number | null;
    }>;

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}Campaigns to consider: ${campaigns.length}`,
    );

    let inserted = 0;
    let skipped = 0;

    for (const campaign of campaigns) {
      const existing = (await qr.manager.query(
        `
          SELECT COUNT(*)::int AS count
          FROM campaign_review
          WHERE campaign_id = $1
            AND status = 'submitted'
        `,
        [campaign.campaign_id],
      )) as Array<{ count: number }>;

      const existingCount = Number(existing[0]?.count ?? 0) || 0;
      if (existingCount > 0) {
        skipped += 1;
        console.log(
          `SKIP campaign=${campaign.campaign_id} already has ${existingCount} submitted review(s)`,
        );
        continue;
      }

      const guests = (await qr.manager.query(
        `
          SELECT DISTINCT ON (fe.customer_id)
            fe.customer_id,
            cu.name,
            cu.email
          FROM funnel_event fe
          INNER JOIN customers cu ON cu.id = fe.customer_id
          WHERE fe.funnel_id = $1
            AND fe.customer_id IS NOT NULL
            AND fe.deleted_at IS NULL
            AND fe.event_type IN ('signup', 'payment')
          ORDER BY fe.customer_id ASC, fe.created_at DESC
          LIMIT $2
        `,
        [campaign.funnel_id, PER_CAMPAIGN_LIMIT],
      )) as Array<{
        customer_id: number;
        name: string | null;
        email: string | null;
      }>;

      if (!campaign.funnel_id || guests.length === 0) {
        skipped += 1;
        console.log(
          `SKIP campaign=${campaign.campaign_id} no funnel guests to backfill`,
        );
        continue;
      }

      console.log(
        `${DRY_RUN ? '[dry-run] ' : ''}BACKFILL campaign=${campaign.campaign_id} guests=${guests.length}`,
      );

      for (let i = 0; i < guests.length; i += 1) {
        const guest = guests[i];
        const token = randomBytes(32).toString('base64url');
        const submittedAt = new Date(
          Date.now() - (i + 1) * 36 * 60 * 60 * 1000,
        );
        const expiresAt = new Date(submittedAt);
        expiresAt.setDate(expiresAt.getDate() + 30);

        if (DRY_RUN) {
          inserted += 1;
          continue;
        }

        await qr.manager.query(
          `
            INSERT INTO campaign_review (
              token_hash,
              business_id,
              campaign_id,
              funnel_id,
              customer_id,
              automation_id,
              execution_id,
              node_id,
              status,
              rating,
              comment,
              guest_name,
              guest_email,
              expires_at,
              submitted_at,
              created_at,
              updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              NULL, NULL, NULL,
              'submitted',
              $6, $7, $8, $9, $10, $11,
              NOW(), NOW()
            )
          `,
          [
            hashToken(token),
            campaign.business_id,
            campaign.campaign_id,
            campaign.funnel_id,
            guest.customer_id,
            pickRating(i),
            pickComment(i),
            guest.name?.trim() || null,
            guest.email?.trim() || null,
            expiresAt.toISOString(),
            submittedAt.toISOString(),
          ],
        );
        inserted += 1;
      }
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}Done. inserted=${inserted} skippedCampaigns=${skipped}`,
    );
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
