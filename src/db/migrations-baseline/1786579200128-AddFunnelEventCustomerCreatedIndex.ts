import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelEventCustomerCreatedIndex1786579200128
  implements MigrationInterface
{
  name = 'AddFunnelEventCustomerCreatedIndex1786579200128';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_event_funnel_customer_created"
        ON "funnel_event" ("funnel_id", "customer_id", "created_at")
        WHERE "deleted_at" IS NULL AND "customer_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_funnel_paid_effective"
        ON "funnel_payment" ("funnel_id", (COALESCE("paid_at", "created_at")))
        WHERE "deleted_at" IS NULL AND "status" = 'paid'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_funnel_paid_effective"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_event_funnel_customer_created"`,
    );
  }
}
