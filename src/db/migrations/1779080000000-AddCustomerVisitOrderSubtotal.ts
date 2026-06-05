import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerVisitOrderSubtotal1779080000000
  implements MigrationInterface
{
  name = 'AddCustomerVisitOrderSubtotal1779080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      ADD COLUMN IF NOT EXISTS "order_subtotal" numeric(10, 2) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      DROP COLUMN IF EXISTS "order_subtotal"
    `);
  }
}
