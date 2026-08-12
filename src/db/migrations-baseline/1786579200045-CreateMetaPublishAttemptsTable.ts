import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaPublishAttemptsTable1786579200045 implements MigrationInterface {
  name = 'CreateMetaPublishAttemptsTable1786579200045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meta_publish_attempts');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "meta_publish_attempts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "draft_id" uuid NOT NULL, "business_id" integer NOT NULL, "user_id" integer NOT NULL, "job_id" character varying(128), "step" character varying(64) NOT NULL, "status" character varying(32) NOT NULL, "meta_id" character varying(64), "error_message" text, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cd7f328cd8ea9d1799a9bb684a4" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_publish_attempts" CASCADE`);
  }
}
