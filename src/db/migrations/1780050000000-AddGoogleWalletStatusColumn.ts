import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleWalletStatusColumn1780050000000
  implements MigrationInterface
{
  name = 'AddGoogleWalletStatusColumn1780050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_status" character varying(32) NOT NULL DEFAULT 'NOT_ADDED'
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_pending_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      UPDATE "coupons"
      SET "google_wallet_status" = CASE
        WHEN "google_wallet_added" = true THEN 'ADDED'
        WHEN "google_wallet_removed_at" IS NOT NULL THEN 'REMOVED'
        ELSE 'NOT_ADDED'
      END
      WHERE "google_wallet_status" = 'NOT_ADDED'
        AND (
          "google_wallet_added" = true
          OR "google_wallet_removed_at" IS NOT NULL
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_coupons_google_wallet_status_pending"
      ON "coupons" ("google_wallet_status", "google_wallet_pending_at")
      WHERE "google_wallet_status" = 'PENDING'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_coupons_google_wallet_status_pending"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_pending_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_status"
    `);
  }
}
