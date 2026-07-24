import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropOrdersCustomerAndCollectedBy1779676000000
  implements MigrationInterface
{
  name = 'DropOrdersCustomerAndCollectedBy1779676000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_orders_business_customer"`,
    );

    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "FK_orders_customer"
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "FK_orders_collected_by_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "customer_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "collected_by_user_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "customer_id" integer NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "collected_by_user_id" integer NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "FK_orders_customer"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_orders_customer'
        ) THEN
          ALTER TABLE "orders"
          ADD CONSTRAINT "FK_orders_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "FK_orders_collected_by_user"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_orders_collected_by_user'
        ) THEN
          ALTER TABLE "orders"
          ADD CONSTRAINT "FK_orders_collected_by_user"
          FOREIGN KEY ("collected_by_user_id") REFERENCES "users"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_business_customer"
      ON "orders" ("restaurant_id", "customer_id")
    `);
  }
}
