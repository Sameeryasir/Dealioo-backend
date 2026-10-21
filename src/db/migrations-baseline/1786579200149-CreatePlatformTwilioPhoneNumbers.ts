import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformTwilioPhoneNumbers1786579200149
  implements MigrationInterface
{
  name = 'CreatePlatformTwilioPhoneNumbers1786579200149';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_twilio_phone_numbers" (
        "id" SERIAL NOT NULL,
        "phone_sid" character varying(64) NOT NULL,
        "phone_number" character varying(32) NOT NULL,
        "friendly_name" character varying(255),
        "status" character varying(64),
        "address_requirement" character varying(64),
        "date_created" TIMESTAMP WITH TIME ZONE,
        "webhook_url" text,
        "webhook_configured" boolean NOT NULL DEFAULT false,
        "cap_sms" boolean NOT NULL DEFAULT false,
        "cap_mms" boolean NOT NULL DEFAULT false,
        "cap_voice" boolean NOT NULL DEFAULT false,
        "cap_fax" boolean NOT NULL DEFAULT false,
        "business_id" integer,
        "connected_at" TIMESTAMP WITH TIME ZONE,
        "last_synced_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_twilio_phone_numbers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_platform_twilio_phone_numbers_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_platform_twilio_phone_numbers_sid"
        ON "platform_twilio_phone_numbers" ("phone_sid")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_platform_twilio_phone_numbers_number"
        ON "platform_twilio_phone_numbers" ("phone_number")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_platform_twilio_phone_numbers_business"
        ON "platform_twilio_phone_numbers" ("business_id")
    `);

    await queryRunner.query(`
      INSERT INTO "platform_twilio_phone_numbers" (
        "phone_sid",
        "phone_number",
        "business_id",
        "connected_at",
        "webhook_configured",
        "last_synced_at",
        "created_at",
        "updated_at"
      )
      SELECT
        b."twilio_phone_sid",
        b."twilio_phone_number",
        b."id",
        b."twilio_connected_at",
        false,
        now(),
        COALESCE(b."twilio_connected_at", b."created_at", now()),
        now()
      FROM "businesses" b
      WHERE b."twilio_phone_sid" IS NOT NULL
        AND TRIM(b."twilio_phone_sid") <> ''
        AND b."twilio_phone_number" IS NOT NULL
        AND TRIM(b."twilio_phone_number") <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM "platform_twilio_phone_numbers" p
          WHERE p."phone_sid" = b."twilio_phone_sid"
             OR p."phone_number" = b."twilio_phone_number"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_platform_twilio_phone_numbers_business"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_platform_twilio_phone_numbers_number"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_platform_twilio_phone_numbers_sid"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "platform_twilio_phone_numbers"`,
    );
  }
}
