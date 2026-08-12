import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaCampaignDraftsTable1786579200042 implements MigrationInterface {
  name = 'CreateMetaCampaignDraftsTable1786579200042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meta_campaign_drafts');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "meta_campaign_drafts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" integer NOT NULL, "business_id" integer NOT NULL, "current_step" integer NOT NULL DEFAULT '1', "status" character varying(32) NOT NULL DEFAULT 'draft', "campaign_data" jsonb, "adset_data" jsonb, "ad_creative_data" jsonb, "meta_campaign_id" character varying(64), "meta_adset_id" character varying(64), "meta_creative_id" character varying(64), "meta_ad_id" character varying(64), "error_message" text, "version" integer NOT NULL DEFAULT '1', "completed_steps" integer array NOT NULL DEFAULT '{}', "last_saved_at" TIMESTAMP WITH TIME ZONE, "publish_status" character varying(32), "publish_job_id" character varying(128), "publish_step" character varying(64), "publish_progress" integer NOT NULL DEFAULT '0', "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_261e64be5c890b24cb53fd95464" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_campaign_drafts" CASCADE`);
  }
}
