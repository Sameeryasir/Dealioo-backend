import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCouponGoogleWalletFields1780030000000
  implements MigrationInterface
{
  name = 'AddCouponGoogleWalletFields1780030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_object_id" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_added" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_added_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_removed_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_coupons_google_wallet_object_id"
      ON "coupons" ("google_wallet_object_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_coupons_google_wallet_object_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_removed_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_added_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_added"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_object_id"
    `);
  }
}
