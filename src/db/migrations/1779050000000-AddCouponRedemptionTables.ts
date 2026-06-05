import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCouponRedemptionTables1779050000000
  implements MigrationInterface
{
  name = 'AddCouponRedemptionTables1779050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "coupons" (
        "id" SERIAL NOT NULL,
        "campaign_id" integer NOT NULL,
        "funnel_id" integer NOT NULL,
        "restaurant_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "funnel_payment_id" integer,
        "qr_token" character varying(64) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'ACTIVE',
        "payment_status" character varying(32) NOT NULL DEFAULT 'PAID',
        "issued_at" TIMESTAMPTZ NOT NULL,
        "redeemed_at" TIMESTAMPTZ,
        "expires_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coupons" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_coupons_qr_token" UNIQUE ("qr_token"),
        CONSTRAINT "UQ_coupons_funnel_payment" UNIQUE ("funnel_payment_id"),
        CONSTRAINT "FK_coupons_campaign" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_coupons_funnel" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_coupons_restaurant" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_coupons_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_coupons_funnel_payment" FOREIGN KEY ("funnel_payment_id") REFERENCES "funnel_payment"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "redemption_logs" (
        "id" SERIAL NOT NULL,
        "coupon_id" integer,
        "customer_id" integer,
        "campaign_id" integer,
        "restaurant_id" integer NOT NULL,
        "scanned_by" integer,
        "scanned_at" TIMESTAMPTZ NOT NULL,
        "device_info" text,
        "success" boolean NOT NULL DEFAULT false,
        "failure_reason" character varying(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_redemption_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_redemption_logs_coupon" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_redemption_logs_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_redemption_logs_campaign" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_redemption_logs_restaurant" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "customer_visits" (
        "id" SERIAL NOT NULL,
        "customer_id" integer NOT NULL,
        "campaign_id" integer NOT NULL,
        "restaurant_id" integer NOT NULL,
        "coupon_id" integer NOT NULL,
        "visit_date" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_visits" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_visits_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_customer_visits_campaign" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_customer_visits_restaurant" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_visits_coupon" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_visits"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redemption_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupons"`);
  }
}
