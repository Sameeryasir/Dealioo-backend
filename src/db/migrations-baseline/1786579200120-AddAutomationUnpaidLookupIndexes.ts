import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationUnpaidLookupIndexes1786579200120
  implements MigrationInterface
{
  name = 'AddAutomationUnpaidLookupIndexes1786579200120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_funnel_status_email_lower"
        ON "funnel_payment" ("funnel_id", "status", (LOWER("customer_email")))
        WHERE "deleted_at" IS NULL AND "customer_email" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_signup_customer"
        ON "funnel_event" ("funnel_id", "customer_id")
        WHERE "deleted_at" IS NULL
          AND "customer_id" IS NOT NULL
          AND "event_type" = 'signup'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_signup_customer"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_funnel_status_email_lower"`,
    );
  }
}
