import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrdersListIndexes1788490000000 implements MigrationInterface {
  name = 'AddOrdersListIndexes1788490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_business_created_active"
        ON "orders" ("business_id", "created_at" DESC)
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_business_status_active"
        ON "orders" ("business_id", "status")
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_visits_order_id_active"
        ON "customer_visits" ("order_id", "visit_date" DESC)
        WHERE "deleted_at" IS NULL AND "order_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_business_order_active"
        ON "funnel_payment" ("business_id", "order_id")
        WHERE "deleted_at" IS NULL AND "order_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_business_order_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customer_visits_order_id_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_orders_business_status_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_orders_business_created_active"`,
    );
  }
}
