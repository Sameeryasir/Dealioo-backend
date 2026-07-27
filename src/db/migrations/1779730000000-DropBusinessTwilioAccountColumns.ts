import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropBusinessTwilioAccountColumns1779730000000
  implements MigrationInterface
{
  name = 'DropBusinessTwilioAccountColumns1779730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
        DROP COLUMN IF EXISTS "twilio_auth_token",
        DROP COLUMN IF EXISTS "twilio_account_sid"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
        ADD COLUMN IF NOT EXISTS "twilio_account_sid" character varying(64),
        ADD COLUMN IF NOT EXISTS "twilio_auth_token" text
    `);
  }
}
