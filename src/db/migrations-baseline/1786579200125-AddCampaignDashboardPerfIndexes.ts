import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignDashboardPerfIndexes1786579200125
  implements MigrationInterface
{
  name = 'AddCampaignDashboardPerfIndexes1786579200125';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_visits_campaign_visit_customer"
        ON "customer_visits" ("campaign_id", "visit_date", "customer_id")
        WHERE "deleted_at" IS NULL AND "customer_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_funnel_instore_paid_at"
        ON "funnel_payment" ("funnel_id", (COALESCE("paid_at", "created_at")))
        WHERE "deleted_at" IS NULL
          AND "status" = 'paid'
          AND (
            "payment_source" = 'SCANNER'
            OR "collection_channel" = 'IN_STORE'
          )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_type_ad_source_created"
        ON "funnel_event" ("funnel_id", "event_type", "ad_source", "created_at")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_type_payment_status_created"
        ON "funnel_event" ("funnel_id", "event_type", "payment_status", "created_at")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_type_payment_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_type_ad_source_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_funnel_instore_paid_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customer_visits_campaign_visit_customer"`,
    );
  }
}
