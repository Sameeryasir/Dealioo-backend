import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnpaidRecipientLookupIndexes1779560000000
  implements MigrationInterface
{
  name = 'AddUnpaidRecipientLookupIndexes1779560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_type_customer"
      ON "funnel_event" ("funnel_id", "event_type", "customer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_funnel_status_email"
      ON "funnel_payment" ("funnel_id", "status", "customer_email")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customers_lower_email"
      ON "customers" (LOWER("email"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customers_lower_email"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_funnel_status_email"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_type_customer"`,
    );
  }
}
