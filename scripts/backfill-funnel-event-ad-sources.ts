import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { FunnelEventType } from '../src/db/entities/funnel-event.entity';
import { resolveGuestAdAttributions } from '../src/modules/funnel-event/guest-ad-attribution.util';

config();

const DRY_RUN = process.argv.includes('--dry-run');
const businessArg = process.argv.find((arg) => arg.startsWith('--business-id='));
const BUSINESS_ID = businessArg
  ? Number(businessArg.slice('--business-id='.length))
  : null;
const BATCH_SIZE = 200;

async function main() {
  if (BUSINESS_ID != null && (!Number.isFinite(BUSINESS_ID) || BUSINESS_ID < 1)) {
    throw new Error('Valid --business-id is required when provided.');
  }

  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();

  try {
    const rows = (await qr.manager.query(
      `
        SELECT
          fe.id,
          fe.funnel_id,
          fe.customer_id,
          c.business_id
        FROM funnel_event fe
        INNER JOIN funnels f ON f.id = fe.funnel_id
        INNER JOIN campaigns c ON c.id = f.campaign_id
        WHERE fe.event_type = $1
          AND fe.customer_id IS NOT NULL
          AND fe.ad_source IS NULL
          AND fe.deleted_at IS NULL
          AND ($2::int IS NULL OR c.business_id = $2)
        ORDER BY fe.id ASC
      `,
      [FunnelEventType.SIGNUP, BUSINESS_ID],
    )) as Array<{
      id: number;
      funnel_id: number;
      customer_id: number;
      business_id: number;
    }>;

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}Backfilling ad_source for ${rows.length} signup event(s)`,
    );

    let updated = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const byBusiness = new Map<number, typeof batch>();
      for (const row of batch) {
        const list = byBusiness.get(row.business_id) ?? [];
        list.push(row);
        byBusiness.set(row.business_id, list);
      }

      for (const [businessId, businessRows] of byBusiness) {
        const byFunnel = new Map<number, typeof businessRows>();
        for (const row of businessRows) {
          const list = byFunnel.get(row.funnel_id) ?? [];
          list.push(row);
          byFunnel.set(row.funnel_id, list);
        }

        for (const [funnelId, funnelRows] of byFunnel) {
          const customerIds = funnelRows.map((row) => Number(row.customer_id));
          const attribution = await resolveGuestAdAttributions(qr.manager, {
            businessId,
            customerIds,
            funnelId,
          });

          for (const row of funnelRows) {
            const match = attribution.get(Number(row.customer_id));
            if (!match) continue;
            updated += 1;
            if (DRY_RUN) continue;
            await qr.manager.query(
              `
                UPDATE funnel_event
                SET
                  ad_source = $1,
                  ad_source_label = $2,
                  ad_source_detail = $3,
                  updated_at = NOW()
                WHERE id = $4
                  AND ad_source IS NULL
              `,
              [match.source, match.label, match.detail, row.id],
            );
          }
        }
      }
    }

    console.log(`Done. ${DRY_RUN ? 'Would update' : 'Updated'} ${updated} row(s).`);
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
