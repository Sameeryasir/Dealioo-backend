import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeetingRequestSlotDetails1786579200141 implements MigrationInterface {
  name = 'AddMeetingRequestSlotDetails1786579200141';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      ADD COLUMN IF NOT EXISTS "scheduled_duration" integer,
      ADD COLUMN IF NOT EXISTS "scheduled_time_zone" character varying(64)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_meeting_request_slot"
      ON "meeting_request" ("scheduled_date", "scheduled_time")
      WHERE "scheduled_date" IS NOT NULL AND "scheduled_time" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_meeting_request_slot"`);
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      DROP COLUMN IF EXISTS "scheduled_duration",
      DROP COLUMN IF EXISTS "scheduled_time_zone"
    `);
  }
}
