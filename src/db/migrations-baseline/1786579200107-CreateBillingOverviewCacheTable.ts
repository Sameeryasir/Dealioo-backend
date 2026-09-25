import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillingOverviewCacheTable1786579200107
  implements MigrationInterface
{
  name = 'CreateBillingOverviewCacheTable1786579200107';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_overview_cache" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "payload" jsonb NOT NULL,
        "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_overview_cache" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_overview_cache_user_id" UNIQUE ("user_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_overview_cache_fetched_at"
      ON "billing_overview_cache" ("fetched_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_billing_overview_cache_fetched_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_overview_cache"`);
  }
}
