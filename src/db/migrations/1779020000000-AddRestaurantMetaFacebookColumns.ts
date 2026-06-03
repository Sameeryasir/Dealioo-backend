import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantMetaFacebookColumns1779020000000
  implements MigrationInterface
{
  name = 'AddRestaurantMetaFacebookColumns1779020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      ADD COLUMN IF NOT EXISTS "meta_user_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "meta_access_token" text,
      ADD COLUMN IF NOT EXISTS "meta_connected_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      DROP COLUMN IF EXISTS "meta_connected_at",
      DROP COLUMN IF EXISTS "meta_access_token",
      DROP COLUMN IF EXISTS "meta_user_id"
    `);
  }
}
