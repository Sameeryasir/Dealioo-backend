import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrdersTable1779670000000 implements MigrationInterface {
  name = 'CreateOrdersTable1779670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "orders" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "customer_id" integer NULL,
        "status" character varying(32) NOT NULL DEFAULT 'paid',
        "source" character varying(32) NOT NULL DEFAULT 'SCANNER',
        "total_amount" integer NOT NULL DEFAULT 0,
        "currency" character varying(10) NOT NULL DEFAULT 'usd',
        "paid_at" TIMESTAMPTZ NULL,
        "collected_by_user_id" integer NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_business"
          FOREIGN KEY ("restaurant_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_orders_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_orders_collected_by_user"
          FOREIGN KEY ("collected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_business_customer"
      ON "orders" ("restaurant_id", "customer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_business_paid_at"
      ON "orders" ("restaurant_id", "paid_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD COLUMN IF NOT EXISTS "order_id" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      DROP CONSTRAINT IF EXISTS "FK_funnel_payment_order_id"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_funnel_payment_order'
        ) THEN
          ALTER TABLE "funnel_payment"
          ADD CONSTRAINT "FK_funnel_payment_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_order_id"
      ON "funnel_payment" ("order_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_order_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      DROP CONSTRAINT IF EXISTS "FK_funnel_payment_order"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_orders_business_paid_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_orders_business_customer"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "orders"`);
  }
}
