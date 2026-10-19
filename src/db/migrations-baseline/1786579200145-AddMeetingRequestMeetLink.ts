import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeetingRequestMeetLink1786579200145 implements MigrationInterface {
  name = 'AddMeetingRequestMeetLink1786579200145';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      ADD COLUMN IF NOT EXISTS "google_meet_link" character varying(512)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request" DROP COLUMN IF EXISTS "google_meet_link"
    `);
  }
}
