import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFacebookCampaignsTable1786579200041 implements MigrationInterface {
  name = 'CreateFacebookCampaignsTable1786579200041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('facebook_campaigns');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "facebook_campaigns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" integer, "business_id" integer NOT NULL, "draft_id" uuid, "ad_account_id" character varying(64) NOT NULL, "meta_campaign_id" character varying(64), "meta_adset_id" character varying(64), "meta_creative_id" character varying(64), "meta_ad_id" character varying(64), "campaign_name" character varying(255), "objective" character varying(64), "budget" numeric(12,2), "start_time" TIMESTAMP WITH TIME ZONE, "end_time" TIMESTAMP WITH TIME ZONE, "facebook_page_id" character varying(64), "instagram_actor_id" character varying(64), "status" character varying(32) NOT NULL DEFAULT 'PENDING', "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_31a1d1fec23ffd3d892219e9ff8" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "facebook_campaigns" CASCADE`);
  }
}
