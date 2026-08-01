import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleCampaignDraftsTable1779910000000
  implements MigrationInterface
{
  name = 'AddGoogleCampaignDraftsTable1779910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "google_campaign_drafts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer NOT NULL,
        "business_id" integer NOT NULL,
        "current_step" integer NOT NULL DEFAULT 1,
        "status" character varying(32) NOT NULL DEFAULT 'draft',
        "draft_data" jsonb,
        "campaign_name" character varying(255),
        "goal" character varying(32),
        "campaign_type" character varying(32),
        "business_name" character varying(255),
        "daily_budget" numeric(12,2),
        "google_campaign_id" character varying(64),
        "error_message" text,
        "version" integer NOT NULL DEFAULT 1,
        "completed_steps" integer[] NOT NULL DEFAULT '{}',
        "last_saved_at" TIMESTAMPTZ,
        "publish_status" character varying(32),
        "publish_job_id" character varying(128),
        "publish_step" character varying(64),
        "publish_progress" integer NOT NULL DEFAULT 0,
        "published_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_google_campaign_drafts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_campaign_drafts_business_id"
      ON "google_campaign_drafts" ("business_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_campaign_drafts_business_user"
      ON "google_campaign_drafts" ("business_id", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_campaign_drafts_status"
      ON "google_campaign_drafts" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_google_campaign_drafts_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_google_campaign_drafts_business_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_google_campaign_drafts_business_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "google_campaign_drafts"`);
  }
}
