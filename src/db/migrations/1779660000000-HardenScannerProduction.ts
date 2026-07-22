import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenScannerProduction1779660000000
  implements MigrationInterface
{
  name = 'HardenScannerProduction1779660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD COLUMN IF NOT EXISTS "payment_source" character varying(32),
      ADD COLUMN IF NOT EXISTS "collection_channel" character varying(32),
      ADD COLUMN IF NOT EXISTS "payment_collected_by" integer,
      ADD COLUMN IF NOT EXISTS "payment_collected_at" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      UPDATE "funnel_payment"
      SET
        "payment_source" = CASE
          WHEN "stripe_payment_intent_id" IS NOT NULL
            OR "stripe_checkout_session_id" IS NOT NULL
          THEN 'STRIPE'
          WHEN "status" = 'paid'
            AND "stripe_payment_intent_id" IS NULL
            AND "stripe_checkout_session_id" IS NULL
          THEN 'SCANNER'
          ELSE "payment_source"
        END,
        "collection_channel" = CASE
          WHEN "stripe_payment_intent_id" IS NOT NULL
            OR "stripe_checkout_session_id" IS NOT NULL
          THEN 'ONLINE'
          WHEN "status" = 'paid'
            AND "stripe_payment_intent_id" IS NULL
            AND "stripe_checkout_session_id" IS NULL
          THEN 'IN_STORE'
          ELSE "collection_channel"
        END,
        "payment_method" = CASE
          WHEN ("stripe_payment_intent_id" IS NOT NULL
            OR "stripe_checkout_session_id" IS NOT NULL)
            AND ("payment_method" IS NULL OR "payment_method" = '')
          THEN 'ONLINE_CARD'
          WHEN "status" = 'paid'
            AND "stripe_payment_intent_id" IS NULL
            AND "stripe_checkout_session_id" IS NULL
            AND ("payment_method" IS NULL OR "payment_method" = '')
          THEN 'OTHER'
          ELSE "payment_method"
        END
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_funnel_payment_source_channel"
      ON "funnel_payment" ("payment_source", "collection_channel")
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "redeemed_by_user_id" integer,
      ADD COLUMN IF NOT EXISTS "scanner_device" character varying(255),
      ADD COLUMN IF NOT EXISTS "register_id" character varying(64)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_coupons_redeemed_by_user'
        ) THEN
          ALTER TABLE "coupons"
          ADD CONSTRAINT "FK_coupons_redeemed_by_user"
          FOREIGN KEY ("redeemed_by_user_id") REFERENCES "users"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DELETE FROM "customer_visits" AS v
      USING "customer_visits" AS newer
      WHERE v.coupon_id = newer.coupon_id
        AND v.id > newer.id
        AND v.deleted_at IS NULL
        AND newer.deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_visits_coupon_id"
      ON "customer_visits" ("coupon_id")
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scanner_purchase_requests" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "staff_user_id" integer NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "request_hash" character varying(64) NOT NULL,
        "response_json" jsonb NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scanner_purchase_requests" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_scanner_purchase_business_idempotency"
      ON "scanner_purchase_requests" ("business_id", "idempotency_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_scanner_purchase_business_idempotency"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "scanner_purchase_requests"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_customer_visits_coupon_id"`,
    );

    await queryRunner.query(`
      ALTER TABLE "coupons"
      DROP CONSTRAINT IF EXISTS "FK_coupons_redeemed_by_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons"
      DROP COLUMN IF EXISTS "register_id",
      DROP COLUMN IF EXISTS "scanner_device",
      DROP COLUMN IF EXISTS "redeemed_by_user_id"
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_funnel_payment_source_channel"`,
    );
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      DROP COLUMN IF EXISTS "payment_collected_at",
      DROP COLUMN IF EXISTS "payment_collected_by",
      DROP COLUMN IF EXISTS "collection_channel",
      DROP COLUMN IF EXISTS "payment_source"
    `);
  }
}
