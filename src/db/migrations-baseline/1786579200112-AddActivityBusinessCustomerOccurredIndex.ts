import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivityBusinessCustomerOccurredIndex1786579200112
  implements MigrationInterface
{
  name = 'AddActivityBusinessCustomerOccurredIndex1786579200112';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_event_business_customer_occurred"
        ON "activity_event" ("business_id", "customer_id", "occurred_at")
        WHERE "customer_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_activity_event_business_customer_occurred"`,
    );
  }
}
