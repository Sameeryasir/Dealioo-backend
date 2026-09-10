import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessMetaIntegrationsTable1788520000000
  implements MigrationInterface
{
  name = 'CreateBusinessMetaIntegrationsTable1788520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_meta_integrations" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "meta_user_id" character varying(64),
        "meta_access_token" text,
        "meta_connected_at" TIMESTAMP WITH TIME ZONE,
        "meta_ad_account_id" character varying(64),
        "meta_connection_status" character varying(32),
        "meta_token_expires_at" TIMESTAMP WITH TIME ZONE,
        "meta_oauth_scopes" text,
        "meta_requested_scopes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_meta_integrations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_business_meta_integrations_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_business_meta_integrations_business_id"
        ON "business_meta_integrations" ("business_id")
    `);

    await queryRunner.query(`
      INSERT INTO "business_meta_integrations" (
        "business_id",
        "meta_user_id",
        "meta_access_token",
        "meta_connected_at",
        "meta_ad_account_id",
        "meta_connection_status",
        "meta_token_expires_at",
        "meta_oauth_scopes",
        "meta_requested_scopes",
        "created_at",
        "updated_at"
      )
      SELECT
        b."id",
        b."meta_user_id",
        b."meta_access_token",
        b."meta_connected_at",
        b."meta_ad_account_id",
        b."meta_connection_status",
        b."meta_token_expires_at",
        b."meta_oauth_scopes",
        b."meta_requested_scopes",
        COALESCE(b."meta_connected_at", b."created_at", now()),
        COALESCE(b."updated_at", now())
      FROM "businesses" b
      WHERE (
          b."meta_user_id" IS NOT NULL
          OR b."meta_access_token" IS NOT NULL
          OR b."meta_connected_at" IS NOT NULL
          OR b."meta_ad_account_id" IS NOT NULL
          OR b."meta_connection_status" IS NOT NULL
          OR b."meta_token_expires_at" IS NOT NULL
          OR b."meta_oauth_scopes" IS NOT NULL
          OR b."meta_requested_scopes" IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "business_meta_integrations" i
          WHERE i."business_id" = b."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_business_meta_integrations_business_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "business_meta_integrations"`);
  }
}
