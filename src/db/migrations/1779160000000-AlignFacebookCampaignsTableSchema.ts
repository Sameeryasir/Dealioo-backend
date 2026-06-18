import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns legacy facebook_campaigns columns (campaign_id, adset_id, …)
 * with the current entity (meta_campaign_id, meta_adset_id, …).
 */
export class AlignFacebookCampaignsTableSchema1779160000000
  implements MigrationInterface
{
  name = 'AlignFacebookCampaignsTableSchema1779160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      ADD COLUMN IF NOT EXISTS "meta_campaign_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "meta_adset_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "meta_creative_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "meta_ad_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      UPDATE "facebook_campaigns"
      SET
        "meta_campaign_id" = COALESCE("meta_campaign_id", "campaign_id"),
        "meta_adset_id" = COALESCE("meta_adset_id", "adset_id"),
        "meta_creative_id" = COALESCE("meta_creative_id", "creative_id"),
        "meta_ad_id" = COALESCE("meta_ad_id", "ad_id")
      WHERE
        "campaign_id" IS NOT NULL
        OR "adset_id" IS NOT NULL
        OR "creative_id" IS NOT NULL
        OR "ad_id" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      DROP COLUMN IF EXISTS "name",
      DROP COLUMN IF EXISTS "campaign_id",
      DROP COLUMN IF EXISTS "adset_id",
      DROP COLUMN IF EXISTS "creative_id",
      DROP COLUMN IF EXISTS "ad_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      ALTER COLUMN "objective" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      ADD COLUMN IF NOT EXISTS "name" character varying(255),
      ADD COLUMN IF NOT EXISTS "campaign_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "adset_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "creative_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "ad_id" character varying(64)
    `);

    await queryRunner.query(`
      UPDATE "facebook_campaigns"
      SET
        "campaign_id" = COALESCE("campaign_id", "meta_campaign_id"),
        "adset_id" = COALESCE("adset_id", "meta_adset_id"),
        "creative_id" = COALESCE("creative_id", "meta_creative_id"),
        "ad_id" = COALESCE("ad_id", "meta_ad_id"),
        "name" = COALESCE("name", 'Campaign')
    `);

    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      ALTER COLUMN "name" SET NOT NULL,
      ALTER COLUMN "objective" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "facebook_campaigns"
      DROP COLUMN IF EXISTS "meta_campaign_id",
      DROP COLUMN IF EXISTS "meta_adset_id",
      DROP COLUMN IF EXISTS "meta_creative_id",
      DROP COLUMN IF EXISTS "meta_ad_id",
      DROP COLUMN IF EXISTS "updated_at"
    `);
  }
}
