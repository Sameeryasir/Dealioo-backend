import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingTrackingFields1779090000000
  implements MigrationInterface
{
  name = 'AddOnboardingTrackingFields1779090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "is_two_factor_verified" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      UPDATE "users"
      SET "is_two_factor_verified" = true
      WHERE "two_factor_enabled" = true
        AND "is_two_factor_verified" = false
    `);

    await queryRunner.query(`
      ALTER TABLE "restaurants"
      ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "restaurants"
      ADD COLUMN IF NOT EXISTS "onboarding_completed_at" TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      UPDATE "restaurants" r
      SET
        "onboarding_completed" = true,
        "onboarding_completed_at" = COALESCE(r."onboarding_completed_at", NOW())
      WHERE EXISTS (
        SELECT 1 FROM "menus" m WHERE m."restaurant_id" = r."id"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      DROP COLUMN IF EXISTS "onboarding_completed_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "restaurants"
      DROP COLUMN IF EXISTS "onboarding_completed"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "is_two_factor_verified"
    `);
  }
}
