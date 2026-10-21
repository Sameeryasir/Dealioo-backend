import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlatformTwilioNumberUsageColumns1786579200150
  implements MigrationInterface
{
  name = 'AddPlatformTwilioNumberUsageColumns1786579200150';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        ADD COLUMN IF NOT EXISTS "usage_sms_count" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        ADD COLUMN IF NOT EXISTS "usage_spend" numeric(12,4) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        ADD COLUMN IF NOT EXISTS "usage_currency" character varying(8)
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        ADD COLUMN IF NOT EXISTS "usage_period_key" character varying(7)
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        ADD COLUMN IF NOT EXISTS "usage_synced_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        DROP COLUMN IF EXISTS "usage_synced_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        DROP COLUMN IF EXISTS "usage_period_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        DROP COLUMN IF EXISTS "usage_currency"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        DROP COLUMN IF EXISTS "usage_spend"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_twilio_phone_numbers"
        DROP COLUMN IF EXISTS "usage_sms_count"
    `);
  }
}
