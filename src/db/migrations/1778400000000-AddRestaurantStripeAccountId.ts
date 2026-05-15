import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantStripeAccountId1778400000000
  implements MigrationInterface
{
  name = 'AddRestaurantStripeAccountId1778400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      ADD "stripe_account_id" character varying(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurants" DROP COLUMN "stripe_account_id"
    `);
  }
}
