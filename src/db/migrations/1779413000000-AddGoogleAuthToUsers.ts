import { MigrationInterface, QueryRunner } from 'typeorm';


export class AddGoogleAuthToUsers1779413000000 implements MigrationInterface {
  name = 'AddGoogleAuthToUsers1779413000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "google_id" varchar NULL,
        ADD COLUMN IF NOT EXISTS "avatar" varchar NULL,
        ADD COLUMN IF NOT EXISTS "first_name" varchar NULL,
        ADD COLUMN IF NOT EXISTS "last_name" varchar NULL,
        ADD COLUMN IF NOT EXISTS "provider" varchar NOT NULL DEFAULT 'LOCAL',
        ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "password_hash" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "phone" DROP NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_google_id"
        ON "users" ("google_id")
        WHERE "google_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_google_id"`);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "last_login_at",
        DROP COLUMN IF EXISTS "provider",
        DROP COLUMN IF EXISTS "last_name",
        DROP COLUMN IF EXISTS "first_name",
        DROP COLUMN IF EXISTS "avatar",
        DROP COLUMN IF EXISTS "google_id"
    `);

    // NOTE: Re-applying NOT NULL may fail if null rows exist — clear those first in production.
    await queryRunner.query(`
      UPDATE "users" SET "phone" = '' WHERE "phone" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "users" SET "password_hash" = '' WHERE "password_hash" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL
    `);
  }
}
