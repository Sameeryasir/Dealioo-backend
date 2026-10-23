import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeetingRequestBusinessDetails1786579200130 implements MigrationInterface {
  name = 'AddMeetingRequestBusinessDetails1786579200130';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      ADD COLUMN IF NOT EXISTS "business_phone" character varying(40),
      ADD COLUMN IF NOT EXISTS "currency" character varying(8),
      ADD COLUMN IF NOT EXISTS "business_email" character varying(255),
      ADD COLUMN IF NOT EXISTS "description" character varying(500),
      ADD COLUMN IF NOT EXISTS "website" character varying(255),
      ADD COLUMN IF NOT EXISTS "state" character varying(100),
      ADD COLUMN IF NOT EXISTS "postal_code" character varying(20),
      ADD COLUMN IF NOT EXISTS "country" character varying(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      DROP COLUMN IF EXISTS "business_phone",
      DROP COLUMN IF EXISTS "currency",
      DROP COLUMN IF EXISTS "business_email",
      DROP COLUMN IF EXISTS "description",
      DROP COLUMN IF EXISTS "website",
      DROP COLUMN IF EXISTS "state",
      DROP COLUMN IF EXISTS "postal_code",
      DROP COLUMN IF EXISTS "country"
    `);
  }
}
