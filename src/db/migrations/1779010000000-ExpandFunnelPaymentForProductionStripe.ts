import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandFunnelPaymentForProductionStripe1779010000000
  implements MigrationInterface
{
  name = 'ExpandFunnelPaymentForProductionStripe1779010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ALTER COLUMN "stripe_payment_intent_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "campaign_id" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "platform_fee_amount" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "refunded_amount" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "stripe_charge_id" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "stripe_dispute_id" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "dispute_status" character varying(64)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_funnel_payment_pending_checkout"
      ON "funnel_payment" ("funnel_id", "restaurant_id", "customer_email", "status")
      WHERE "status" = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_funnel_payment_pending_checkout"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "dispute_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "stripe_dispute_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "stripe_charge_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "refunded_amount"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "platform_fee_amount"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "campaign_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ALTER COLUMN "stripe_payment_intent_id" SET NOT NULL
    `);
  }
}
