import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelPaymentTable1786579200019 implements MigrationInterface {
  name = 'CreateFunnelPaymentTable1786579200019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('funnel_payment');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "funnel_payment" ("id" SERIAL NOT NULL, "funnel_id" integer, "business_id" integer NOT NULL, "campaign_id" integer, "customer_id" integer, "order_id" integer, "stripe_payment_intent_id" character varying(255), "stripe_checkout_session_id" character varying(255), "platform_fee_amount" integer NOT NULL DEFAULT '0', "refunded_amount" integer NOT NULL DEFAULT '0', "stripe_charge_id" character varying(255), "stripe_dispute_id" character varying(255), "dispute_status" character varying(64), "stripe_connected_account_id" character varying(255), "amount" integer NOT NULL, "currency" character varying(10) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'pending', "customer_email" character varying(320) NOT NULL, "payment_method" character varying(64), "payment_source" character varying(32), "collection_channel" character varying(32), "payment_collected_by" integer, "payment_collected_at" TIMESTAMP WITH TIME ZONE, "receipt_url" text, "failure_reason" text, "failed_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "stripe_refund_id" character varying(255), "refunded_at" TIMESTAMP WITH TIME ZONE, "paid_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_dd709560239ddb66910c5af1f50" UNIQUE ("stripe_payment_intent_id"), CONSTRAINT "PK_275bc8a9d817c9ccd2b377dd40c" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_b99026eafb877a13bf576e27d97' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_payment" ADD CONSTRAINT "FK_b99026eafb877a13bf576e27d97" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_f898ca97d1e86d8c5f0711dc8e5' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_payment" ADD CONSTRAINT "FK_f898ca97d1e86d8c5f0711dc8e5" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_4a339826163defe2a4c2409599f' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_payment" ADD CONSTRAINT "FK_4a339826163defe2a4c2409599f" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_f552ae0186fe4eca02151edd200' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_payment" ADD CONSTRAINT "FK_f552ae0186fe4eca02151edd200" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_payment" CASCADE`);
  }
}
