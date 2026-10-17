import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessDashboardPerfIndexes1786579200129
  implements MigrationInterface
{
  name = 'AddBusinessDashboardPerfIndexes1786579200129';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_business_paid_effective"
        ON "funnel_payment" ("business_id", (COALESCE("paid_at", "created_at")))
        WHERE "deleted_at" IS NULL AND "status" = 'paid'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_business_earnings_effective"
        ON "funnel_payment" ("business_id", (COALESCE("paid_at", "created_at")))
        WHERE "deleted_at" IS NULL
          AND "status" IN ('paid', 'partially_refunded')
          AND "campaign_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_business_campaign_customer"
        ON "funnel_payment" ("business_id", "campaign_id", "customer_id")
        WHERE "deleted_at" IS NULL
          AND "status" IN ('paid', 'partially_refunded')
          AND "campaign_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_business_campaign_customer"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_business_earnings_effective"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_business_paid_effective"`,
    );
  }
}
