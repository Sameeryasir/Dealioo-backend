import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessGoogleAdsIntegrationsTable1788530000000
  implements MigrationInterface
{
  name = 'CreateBusinessGoogleAdsIntegrationsTable1788530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_google_ads_integrations" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "google_user_id" character varying(128),
        "google_refresh_token" text,
        "google_access_token" text,
        "google_connected_at" TIMESTAMP WITH TIME ZONE,
        "google_customer_id" character varying(32),
        "google_login_customer_id" character varying(32),
        "google_connection_status" character varying(32),
        "google_token_expires_at" TIMESTAMP WITH TIME ZONE,
        "google_oauth_scopes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_google_ads_integrations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_business_google_ads_integrations_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_business_google_ads_integrations_business_id"
        ON "business_google_ads_integrations" ("business_id")
    `);

    await queryRunner.query(`
      INSERT INTO "business_google_ads_integrations" (
        "business_id",
        "google_user_id",
        "google_refresh_token",
        "google_access_token",
        "google_connected_at",
        "google_customer_id",
        "google_login_customer_id",
        "google_connection_status",
        "google_token_expires_at",
        "google_oauth_scopes",
        "created_at",
        "updated_at"
      )
      SELECT
        b."id",
        b."google_user_id",
        b."google_refresh_token",
        b."google_access_token",
        b."google_connected_at",
        b."google_customer_id",
        b."google_login_customer_id",
        b."google_connection_status",
        b."google_token_expires_at",
        b."google_oauth_scopes",
        COALESCE(b."google_connected_at", b."created_at", now()),
        COALESCE(b."updated_at", now())
      FROM "businesses" b
      WHERE (
          b."google_user_id" IS NOT NULL
          OR b."google_refresh_token" IS NOT NULL
          OR b."google_access_token" IS NOT NULL
          OR b."google_connected_at" IS NOT NULL
          OR b."google_customer_id" IS NOT NULL
          OR b."google_login_customer_id" IS NOT NULL
          OR b."google_connection_status" IS NOT NULL
          OR b."google_token_expires_at" IS NOT NULL
          OR b."google_oauth_scopes" IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "business_google_ads_integrations" i
          WHERE i."business_id" = b."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_business_google_ads_integrations_business_id"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "business_google_ads_integrations"`,
    );
  }
}
