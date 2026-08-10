import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaAdCampaignStatsSnapshotsTable1779990000000
  implements MigrationInterface
{
  name = 'CreateMetaAdCampaignStatsSnapshotsTable1779990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meta_ad_campaign_stats_snapshots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "business_id" integer NOT NULL,
        "ad_account_id" character varying(64) NOT NULL,
        "date_preset" character varying(32) NOT NULL,
        "include_insights" boolean NOT NULL DEFAULT true,
        "payload" jsonb NOT NULL,
        "fetched_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meta_ad_campaign_stats_snapshots" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_meta_ad_campaign_stats_snapshots_biz_account_preset"
      ON "meta_ad_campaign_stats_snapshots" ("business_id", "ad_account_id", "date_preset")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_ad_campaign_stats_snapshots_business"
      ON "meta_ad_campaign_stats_snapshots" ("business_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_ad_campaign_stats_snapshots_business"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_meta_ad_campaign_stats_snapshots_biz_account_preset"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "meta_ad_campaign_stats_snapshots"`,
    );
  }
}
