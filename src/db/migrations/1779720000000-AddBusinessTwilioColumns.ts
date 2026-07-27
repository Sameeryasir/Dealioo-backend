import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessTwilioColumns1779720000000
  implements MigrationInterface
{
  name = 'AddBusinessTwilioColumns1779720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
        ADD COLUMN IF NOT EXISTS "twilio_account_sid" character varying(64),
        ADD COLUMN IF NOT EXISTS "twilio_auth_token" text,
        ADD COLUMN IF NOT EXISTS "twilio_phone_number" character varying(32),
        ADD COLUMN IF NOT EXISTS "twilio_phone_sid" character varying(64),
        ADD COLUMN IF NOT EXISTS "twilio_connected_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
        DROP COLUMN IF EXISTS "twilio_connected_at",
        DROP COLUMN IF EXISTS "twilio_phone_sid",
        DROP COLUMN IF EXISTS "twilio_phone_number",
        DROP COLUMN IF EXISTS "twilio_auth_token",
        DROP COLUMN IF EXISTS "twilio_account_sid"
    `);
  }
}
