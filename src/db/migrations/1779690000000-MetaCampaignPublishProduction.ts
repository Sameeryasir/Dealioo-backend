import { MigrationInterface, QueryRunner } from 'typeorm';

export class MetaCampaignPublishProduction1779690000000
  implements MigrationInterface
{
  name = 'MetaCampaignPublishProduction1779690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meta_campaign_drafts"
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "completed_steps" integer[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "last_saved_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "publish_status" character varying(32) NULL,
        ADD COLUMN IF NOT EXISTS "publish_job_id" character varying(128) NULL,
        ADD COLUMN IF NOT EXISTS "publish_step" character varying(64) NULL,
        ADD COLUMN IF NOT EXISTS "publish_progress" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meta_campaign_media" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "draft_id" uuid NULL,
        "restaurant_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "media_type" character varying(16) NOT NULL,
        "filename" character varying(512) NOT NULL,
        "mime_type" character varying(128) NOT NULL,
        "size_bytes" bigint NOT NULL DEFAULT 0,
        "storage_key" character varying(1024) NULL,
        "storage_url" character varying(2048) NULL,
        "upload_status" character varying(32) NOT NULL DEFAULT 'uploading',
        "meta_image_hash" character varying(255) NULL,
        "meta_video_id" character varying(64) NULL,
        "error_message" text NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_campaign_media_draft"
        ON "meta_campaign_media" ("draft_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_campaign_media_business"
        ON "meta_campaign_media" ("restaurant_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_campaign_media_storage_url"
        ON "meta_campaign_media" ("storage_url")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meta_publish_attempts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "draft_id" uuid NOT NULL,
        "restaurant_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "job_id" character varying(128) NULL,
        "step" character varying(64) NOT NULL,
        "status" character varying(32) NOT NULL,
        "meta_id" character varying(64) NULL,
        "error_message" text NULL,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_publish_attempts_draft"
        ON "meta_publish_attempts" ("draft_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_publish_attempts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_campaign_media"`);
    await queryRunner.query(`
      ALTER TABLE "meta_campaign_drafts"
        DROP COLUMN IF EXISTS "published_at",
        DROP COLUMN IF EXISTS "publish_progress",
        DROP COLUMN IF EXISTS "publish_step",
        DROP COLUMN IF EXISTS "publish_job_id",
        DROP COLUMN IF EXISTS "publish_status",
        DROP COLUMN IF EXISTS "last_saved_at",
        DROP COLUMN IF EXISTS "completed_steps",
        DROP COLUMN IF EXISTS "version"
    `);
  }
}
