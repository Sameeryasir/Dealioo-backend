import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelPaymentCustomerId1779810000000
  implements MigrationInterface
{
  name = 'AddFunnelPaymentCustomerId1779810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('funnel_payment'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_deleted_at"
      ON "funnel_payment" ("deleted_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD COLUMN IF NOT EXISTS "customer_id" integer NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      DROP CONSTRAINT IF EXISTS "FK_funnel_payment_customer"
    `);

    if (await queryRunner.hasTable('customers')) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'FK_funnel_payment_customer'
          ) THEN
            ALTER TABLE "funnel_payment"
            ADD CONSTRAINT "FK_funnel_payment_customer"
            FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
            ON DELETE SET NULL;
          END IF;
        END $$;
      `);
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_customer_id"
      ON "funnel_payment" ("customer_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('funnel_payment'))) {
      return;
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_customer_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      DROP CONSTRAINT IF EXISTS "FK_funnel_payment_customer"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      DROP COLUMN IF EXISTS "customer_id"
    `);
  }
}
