import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivityDashboardPerfIndexes1786579200111
  implements MigrationInterface
{
  name = 'AddActivityDashboardPerfIndexes1786579200111';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_event_business_type_customer"
        ON "activity_event" ("business_id", "event_type", "customer_id")
        WHERE "customer_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_event_business_type_occurred"
        ON "activity_event" ("business_id", "event_type", "occurred_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_business_status_customer"
        ON "funnel_payment" ("business_id", "status", "customer_id")
        WHERE "customer_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_business_status_customer"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_activity_event_business_type_occurred"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_activity_event_business_type_customer"`,
    );
  }
}
