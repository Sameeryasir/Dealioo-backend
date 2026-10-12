import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignDashboardFunnelIndexes1786579200116
  implements MigrationInterface
{
  name = 'AddCampaignDashboardFunnelIndexes1786579200116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_created"
        ON "funnel_event" ("funnel_id", "created_at")
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_type_created"
        ON "funnel_event" ("funnel_id", "event_type", "created_at")
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_type_customer_created"
        ON "funnel_event" ("funnel_id", "event_type", "customer_id", "created_at")
        WHERE "deleted_at" IS NULL AND "customer_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_payment_id"
        ON "funnel_event" ("funnel_payment_id")
        WHERE "deleted_at" IS NULL AND "funnel_payment_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_funnel_status_paid_at"
        ON "funnel_payment" ("funnel_id", "status", (COALESCE("paid_at", "created_at")))
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_funnel_status_customer"
        ON "funnel_payment" ("funnel_id", "status", "customer_id")
        WHERE "deleted_at" IS NULL AND "customer_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_analytics_funnel_type_created"
        ON "funnel_analytics_event" ("funnel_id", "event_type", "created_at")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_analytics_funnel_type_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_funnel_status_customer"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_funnel_status_paid_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_payment_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_type_customer_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_type_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_created"`,
    );
  }
}
