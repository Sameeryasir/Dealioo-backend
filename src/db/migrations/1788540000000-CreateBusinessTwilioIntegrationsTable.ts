import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessTwilioIntegrationsTable1788540000000
  implements MigrationInterface
{
  name = 'CreateBusinessTwilioIntegrationsTable1788540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_twilio_integrations" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "twilio_phone_number" character varying(32),
        "twilio_phone_sid" character varying(64),
        "twilio_connected_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_twilio_integrations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_business_twilio_integrations_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_business_twilio_integrations_business_id"
        ON "business_twilio_integrations" ("business_id")
    `);

    await queryRunner.query(`
      INSERT INTO "business_twilio_integrations" (
        "business_id",
        "twilio_phone_number",
        "twilio_phone_sid",
        "twilio_connected_at",
        "created_at",
        "updated_at"
      )
      SELECT
        b."id",
        b."twilio_phone_number",
        b."twilio_phone_sid",
        b."twilio_connected_at",
        COALESCE(b."twilio_connected_at", b."created_at", now()),
        COALESCE(b."updated_at", now())
      FROM "businesses" b
      WHERE (
          b."twilio_phone_number" IS NOT NULL
          OR b."twilio_phone_sid" IS NOT NULL
          OR b."twilio_connected_at" IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "business_twilio_integrations" i
          WHERE i."business_id" = b."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_business_twilio_integrations_business_id"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "business_twilio_integrations"`,
    );
  }
}
