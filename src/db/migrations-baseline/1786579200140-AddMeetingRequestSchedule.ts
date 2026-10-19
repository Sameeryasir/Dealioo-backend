import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeetingRequestSchedule1786579200140 implements MigrationInterface {
  name = 'AddMeetingRequestSchedule1786579200140';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      ADD COLUMN IF NOT EXISTS "scheduled_date" character varying(10),
      ADD COLUMN IF NOT EXISTS "scheduled_time" character varying(5)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      DROP COLUMN IF EXISTS "scheduled_date",
      DROP COLUMN IF EXISTS "scheduled_time"
    `);
  }
}
