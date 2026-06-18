import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFacebookCampaignsTable1779150000000
  implements MigrationInterface
{
  name = 'AddFacebookCampaignsTable1779150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "facebook_campaigns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "restaurant_id" integer NOT NULL,
        "ad_account_id" character varying(64) NOT NULL,
        "meta_campaign_id" character varying(64),
        "meta_adset_id" character varying(64),
        "meta_creative_id" character varying(64),
        "meta_ad_id" character varying(64),
        "objective" character varying(64),
        "status" character varying(32) NOT NULL DEFAULT 'PAUSED',
        "error_message" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_facebook_campaigns" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_facebook_campaigns_restaurant_id"
      ON "facebook_campaigns" ("restaurant_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_facebook_campaigns_restaurant_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "facebook_campaigns"`);
  }
}
