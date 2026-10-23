import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGoogleCalendarConnections1786579200143 implements MigrationInterface {
  name = 'CreateGoogleCalendarConnections1786579200143';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "google_calendar_connections" (
        "id" SERIAL NOT NULL,
        "google_email" character varying(255) NOT NULL,
        "refresh_token" text NOT NULL,
        "calendar_id" character varying(255) NOT NULL DEFAULT 'primary',
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_google_calendar_connections" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "google_calendar_connections"
    `);
  }
}
