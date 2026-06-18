import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandFacebookCampaignsAndAddMetaCampaignErrors1779170000000
  implements MigrationInterface
{
  name = 'ExpandFacebookCampaignsAndAddMetaCampaignErrors1779170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      ADD COLUMN IF NOT EXISTS "user_id" integer,
      ADD COLUMN IF NOT EXISTS "campaign_name" character varying(255),
      ADD COLUMN IF NOT EXISTS "budget" numeric(12, 2),
      ADD COLUMN IF NOT EXISTS "start_time" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "end_time" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "facebook_page_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "instagram_actor_id" character varying(64)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meta_campaign_errors" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer NOT NULL,
        "restaurant_id" integer NOT NULL,
        "facebook_campaign_id" uuid,
        "step" character varying(32) NOT NULL,
        "meta_error_code" integer,
        "meta_error_message" text NOT NULL,
        "raw_response" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meta_campaign_errors" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_campaign_errors_restaurant_id"
      ON "meta_campaign_errors" ("restaurant_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_campaign_errors_facebook_campaign_id"
      ON "meta_campaign_errors" ("facebook_campaign_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_campaign_errors_facebook_campaign_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_campaign_errors_restaurant_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_campaign_errors"`);

    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      DROP COLUMN IF EXISTS "instagram_actor_id",
      DROP COLUMN IF EXISTS "facebook_page_id",
      DROP COLUMN IF EXISTS "end_time",
      DROP COLUMN IF EXISTS "start_time",
      DROP COLUMN IF EXISTS "budget",
      DROP COLUMN IF EXISTS "campaign_name",
      DROP COLUMN IF EXISTS "user_id"
    `);
  }
}
