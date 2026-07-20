import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerVisitsBusinessCustomerIndex1779572000000
  implements MigrationInterface
{
  name = 'AddCustomerVisitsBusinessCustomerIndex1779572000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_visits_business_customer"
      ON "customer_visits" ("restaurant_id", "customer_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_customer_visits_business_customer"
    `);
  }
}
