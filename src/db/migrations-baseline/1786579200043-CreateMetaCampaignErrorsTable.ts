import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaCampaignErrorsTable1786579200043 implements MigrationInterface {
  name = 'CreateMetaCampaignErrorsTable1786579200043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meta_campaign_errors');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "meta_campaign_errors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" integer NOT NULL, "business_id" integer NOT NULL, "facebook_campaign_id" uuid, "step" character varying(32) NOT NULL, "meta_error_code" integer, "meta_error_message" text NOT NULL, "raw_response" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b9874ddd2d7fc9de65faf32f9e4" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_campaign_errors" CASCADE`);
  }
}
