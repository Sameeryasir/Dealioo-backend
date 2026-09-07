import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerVisitExtraItems1788440000000
  implements MigrationInterface
{
  name = 'AddCustomerVisitExtraItems1788440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
        ADD COLUMN IF NOT EXISTS "extra_items" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
        DROP COLUMN IF EXISTS "extra_items"
    `);
  }
}
