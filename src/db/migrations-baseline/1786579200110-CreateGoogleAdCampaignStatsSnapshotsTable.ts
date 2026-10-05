import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGoogleAdCampaignStatsSnapshotsTable1786579200110
  implements MigrationInterface
{
  name = 'CreateGoogleAdCampaignStatsSnapshotsTable1786579200110';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable(
      'google_ad_campaign_stats_snapshots',
    );
    if (!hasTable) {
      await queryRunner.query(
        `CREATE TABLE "google_ad_campaign_stats_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "business_id" integer NOT NULL, "customer_id" character varying(64) NOT NULL, "date_preset" character varying(32) NOT NULL, "payload" jsonb NOT NULL, "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_google_ad_campaign_stats_snapshots" PRIMARY KEY ("id"))`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_google_ad_campaign_stats_snapshots_business" ON "google_ad_campaign_stats_snapshots" ("business_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_google_ad_campaign_stats_snapshots_biz_customer_preset" ON "google_ad_campaign_stats_snapshots" ("business_id", "customer_id", "date_preset") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "google_ad_campaign_stats_snapshots" CASCADE`,
    );
  }
}
