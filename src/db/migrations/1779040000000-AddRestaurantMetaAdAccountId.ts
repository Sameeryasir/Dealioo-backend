import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantMetaAdAccountId1779040000000
  implements MigrationInterface
{
  name = 'AddRestaurantMetaAdAccountId1779040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      ADD COLUMN IF NOT EXISTS "meta_ad_account_id" character varying(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      DROP COLUMN IF EXISTS "meta_ad_account_id"
    `);
  }
}
