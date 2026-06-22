import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantGoogleLoginCustomerId1779300000000
  implements MigrationInterface
{
  name = 'AddRestaurantGoogleLoginCustomerId1779300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      ADD COLUMN IF NOT EXISTS "google_login_customer_id" character varying(32)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      DROP COLUMN IF EXISTS "google_login_customer_id"
    `);
  }
}
