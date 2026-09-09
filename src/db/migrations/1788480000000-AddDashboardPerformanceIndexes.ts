import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDashboardPerformanceIndexes1788480000000
  implements MigrationInterface
{
  name = 'AddDashboardPerformanceIndexes1788480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_visit_addon_items_business_created"
        ON "visit_addon_items" ("business_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_visit_addon_items_business_campaign_created"
        ON "visit_addon_items" ("business_id", "campaign_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_business_status_campaign"
        ON "funnel_payment" ("business_id", "status", "campaign_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_business_paid_created"
        ON "funnel_payment" ("business_id", "paid_at", "created_at")
        WHERE "status" = 'paid' AND "campaign_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_business_paid_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_business_status_campaign"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_visit_addon_items_business_campaign_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_visit_addon_items_business_created"`,
    );
  }
}
