import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelAnalyticsAdSourceColumns1786579200114
  implements MigrationInterface
{
  name = 'AddFunnelAnalyticsAdSourceColumns1786579200114';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_analytics_event"
        ADD COLUMN IF NOT EXISTS "ad_source" character varying(16),
        ADD COLUMN IF NOT EXISTS "ad_source_label" character varying(64),
        ADD COLUMN IF NOT EXISTS "ad_source_detail" character varying(255)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_analytics_funnel_ad_source"
        ON "funnel_analytics_event" ("funnel_id", "ad_source")
        WHERE "ad_source" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_analytics_funnel_ad_source"`,
    );
    await queryRunner.query(`
      ALTER TABLE "funnel_analytics_event"
        DROP COLUMN IF EXISTS "ad_source_detail",
        DROP COLUMN IF EXISTS "ad_source_label",
        DROP COLUMN IF EXISTS "ad_source"
    `);
  }
}
