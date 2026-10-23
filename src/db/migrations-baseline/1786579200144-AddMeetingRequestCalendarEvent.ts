import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeetingRequestCalendarEvent1786579200144 implements MigrationInterface {
  name = 'AddMeetingRequestCalendarEvent1786579200144';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      ADD COLUMN IF NOT EXISTS "google_event_id" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      ADD COLUMN IF NOT EXISTS "google_event_link" character varying(512)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request" DROP COLUMN IF EXISTS "google_event_link"
    `);
    await queryRunner.query(`
      ALTER TABLE "meeting_request" DROP COLUMN IF EXISTS "google_event_id"
    `);
  }
}
