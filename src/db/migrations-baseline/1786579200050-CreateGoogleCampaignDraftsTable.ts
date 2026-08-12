import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGoogleCampaignDraftsTable1786579200050 implements MigrationInterface {
  name = 'CreateGoogleCampaignDraftsTable1786579200050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('google_campaign_drafts');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "google_campaign_drafts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" integer NOT NULL, "business_id" integer NOT NULL, "created_by" integer, "updated_by" integer, "current_step" integer NOT NULL DEFAULT '1', "status" character varying(32) NOT NULL DEFAULT 'DRAFT', "draft_data" jsonb, "campaign_name" character varying(255), "goal" character varying(32), "campaign_type" character varying(32), "business_name" character varying(255), "daily_budget" numeric(12,2), "google_campaign_id" character varying(64), "google_budget_id" character varying(64), "google_ad_group_id" character varying(64), "google_ad_id" character varying(64), "google_keyword_ids" jsonb, "error_message" text, "version" integer NOT NULL DEFAULT '1', "completed_steps" integer array NOT NULL DEFAULT '{}', "last_saved_at" TIMESTAMP WITH TIME ZONE, "publish_status" character varying(32), "publish_job_id" character varying(128), "publish_step" character varying(64), "publish_progress" integer NOT NULL DEFAULT '0', "published_at" TIMESTAMP WITH TIME ZONE, "last_idempotency_key" character varying(128), "last_idempotency_response" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_27302f0b9241be04d6b86c5189e" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "google_campaign_drafts" CASCADE`);
  }
}
