import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetaCampaignDraftsTable1779180000000
  implements MigrationInterface
{
  name = 'AddMetaCampaignDraftsTable1779180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meta_campaign_drafts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer NOT NULL,
        "restaurant_id" integer NOT NULL,
        "current_step" integer NOT NULL DEFAULT 1,
        "status" character varying(32) NOT NULL DEFAULT 'draft',
        "campaign_data" jsonb,
        "adset_data" jsonb,
        "ad_creative_data" jsonb,
        "meta_campaign_id" character varying(64),
        "meta_adset_id" character varying(64),
        "meta_creative_id" character varying(64),
        "meta_ad_id" character varying(64),
        "error_message" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meta_campaign_drafts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_campaign_drafts_restaurant_id"
      ON "meta_campaign_drafts" ("restaurant_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_campaign_drafts_status"
      ON "meta_campaign_drafts" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_campaign_drafts_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_campaign_drafts_restaurant_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_campaign_drafts"`);
  }
}
