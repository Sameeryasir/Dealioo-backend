import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `funnel_payment`: checkout payments for funnel flows, tied to funnel + restaurant,
 * Stripe PaymentIntent / Connect account, amount/currency/status, customer contact, receipt URL,
 * failure/refund/paid timestamps, and audit columns.
 */
export class AddFunnelPaymentTable1778300000000 implements MigrationInterface {
  name = 'AddFunnelPaymentTable1778300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "funnel_payment" (
        "id" SERIAL NOT NULL,
        "funnel_id" integer NOT NULL,
        "restaurant_id" integer NOT NULL,
        "stripe_payment_intent_id" character varying(255) NOT NULL,
        "stripe_connected_account_id" character varying(255),
        "amount" integer NOT NULL,
        "currency" character varying(10) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'pending',
        "customer_email" character varying(320) NOT NULL,
        "payment_method" character varying(64),
        "receipt_url" text,
        "failure_reason" text,
        "paid_at" TIMESTAMPTZ,
        "refunded_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_funnel_payment" PRIMARY KEY ("id"),
        CONSTRAINT "FK_funnel_payment_funnel" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_funnel_payment_restaurant" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "UQ_funnel_payment_stripe_pi" UNIQUE ("stripe_payment_intent_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_payment"`);
  }
}
