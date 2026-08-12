import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMeetingRequestTable1786579200036 implements MigrationInterface {
  name = 'CreateMeetingRequestTable1786579200036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meeting_request');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "meeting_request" ("id" SERIAL NOT NULL, "first_name" character varying(120) NOT NULL, "last_name" character varying(120) NOT NULL, "phone" character varying(40) NOT NULL, "email" character varying(255) NOT NULL, "business_role" character varying(64) NOT NULL, "business_category" character varying(128) NOT NULL, "business_name" character varying(512) NOT NULL, "city_location" character varying(255) NOT NULL, "monthly_revenue" character varying(32) NOT NULL, "marketing_activities" jsonb NOT NULL, "current_situation" text NOT NULL, "start_timeline" character varying(64) NOT NULL, "meeting_commitment" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3f62245c08dea30d2df7d15bcd4" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meeting_request_email" ON "meeting_request" ("email") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meeting_request_created_at" ON "meeting_request" ("created_at") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meeting_request" CASCADE`);
  }
}
