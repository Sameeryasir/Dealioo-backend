import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaCampaignMediaTable1786579200044 implements MigrationInterface {
  name = 'CreateMetaCampaignMediaTable1786579200044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meta_campaign_media');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "meta_campaign_media" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "draft_id" uuid, "business_id" integer NOT NULL, "user_id" integer NOT NULL, "media_type" character varying(16) NOT NULL, "filename" character varying(512) NOT NULL, "mime_type" character varying(128) NOT NULL, "size_bytes" bigint NOT NULL DEFAULT '0', "storage_key" character varying(1024), "storage_url" character varying(2048), "upload_status" character varying(32) NOT NULL DEFAULT 'UPLOADING', "meta_image_hash" character varying(255), "meta_video_id" character varying(64), "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a4ed9fc5668a8a67d6760a0a2d4" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_campaign_media" CASCADE`);
  }
}
