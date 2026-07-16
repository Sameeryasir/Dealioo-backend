import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelPaymentCheckoutSessionId1779500000000
  implements MigrationInterface
{
  name = 'AddFunnelPaymentCheckoutSessionId1779500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" character varying(255)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_funnel_payment_stripe_checkout_session_id"
      ON "funnel_payment" ("stripe_checkout_session_id")
      WHERE "stripe_checkout_session_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_funnel_payment_stripe_checkout_session_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      DROP COLUMN IF EXISTS "stripe_checkout_session_id"
    `);
  }
}
