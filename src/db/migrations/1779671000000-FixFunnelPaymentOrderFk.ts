import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixFunnelPaymentOrderFk1779671000000
  implements MigrationInterface
{
  name = 'FixFunnelPaymentOrderFk1779671000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {}
}
