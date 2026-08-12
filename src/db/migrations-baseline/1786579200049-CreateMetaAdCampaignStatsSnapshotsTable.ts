import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaAdCampaignStatsSnapshotsTable1786579200049 implements MigrationInterface {
  name = 'CreateMetaAdCampaignStatsSnapshotsTable1786579200049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meta_ad_campaign_stats_snapshots');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "meta_ad_campaign_stats_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "business_id" integer NOT NULL, "ad_account_id" character varying(64) NOT NULL, "date_preset" character varying(32) NOT NULL, "include_insights" boolean NOT NULL DEFAULT true, "payload" jsonb NOT NULL, "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d78fa62b991544c068a5bce38ac" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meta_ad_campaign_stats_snapshots_business" ON "meta_ad_campaign_stats_snapshots" ("business_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_meta_ad_campaign_stats_snapshots_biz_account_preset" ON "meta_ad_campaign_stats_snapshots" ("business_id", "ad_account_id", "date_preset") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_ad_campaign_stats_snapshots" CASCADE`);
  }
}
