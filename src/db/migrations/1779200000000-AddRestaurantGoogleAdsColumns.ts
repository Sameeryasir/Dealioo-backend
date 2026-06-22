import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantGoogleAdsColumns1779200000000
  implements MigrationInterface
{
  name = 'AddRestaurantGoogleAdsColumns1779200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      ADD COLUMN IF NOT EXISTS "google_user_id" character varying(128),
      ADD COLUMN IF NOT EXISTS "google_refresh_token" text,
      ADD COLUMN IF NOT EXISTS "google_access_token" text,
      ADD COLUMN IF NOT EXISTS "google_connected_at" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "google_customer_id" character varying(32),
      ADD COLUMN IF NOT EXISTS "google_connection_status" character varying(32),
      ADD COLUMN IF NOT EXISTS "google_token_expires_at" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "google_oauth_scopes" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      DROP COLUMN IF EXISTS "google_oauth_scopes",
      DROP COLUMN IF EXISTS "google_token_expires_at",
      DROP COLUMN IF EXISTS "google_connection_status",
      DROP COLUMN IF EXISTS "google_customer_id",
      DROP COLUMN IF EXISTS "google_connected_at",
      DROP COLUMN IF EXISTS "google_access_token",
      DROP COLUMN IF EXISTS "google_refresh_token",
      DROP COLUMN IF EXISTS "google_user_id"
    `);
  }
}
