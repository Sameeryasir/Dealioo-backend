import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessStripeIntegrationsTable1788510000000
  implements MigrationInterface
{
  name = 'CreateBusinessStripeIntegrationsTable1788510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_stripe_integrations" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "stripe_account_id" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_stripe_integrations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_business_stripe_integrations_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_business_stripe_integrations_business_id"
        ON "business_stripe_integrations" ("business_id")
    `);

    await queryRunner.query(`
      INSERT INTO "business_stripe_integrations" (
        "business_id",
        "stripe_account_id",
        "created_at",
        "updated_at"
      )
      SELECT
        b."id",
        b."stripe_account_id",
        COALESCE(b."created_at", now()),
        COALESCE(b."updated_at", now())
      FROM "businesses" b
      WHERE b."stripe_account_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "business_stripe_integrations" i
          WHERE i."business_id" = b."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_business_stripe_integrations_business_id"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "business_stripe_integrations"`,
    );
  }
}
