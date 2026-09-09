import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVisitAddonItems1788470000000 implements MigrationInterface {
  name = 'CreateVisitAddonItems1788470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "visit_addon_items" (
        "id" SERIAL NOT NULL,
        "customer_visit_id" integer NOT NULL,
        "business_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "name" character varying(120) NOT NULL,
        "unit_price_cents" integer NOT NULL,
        "qty" integer NOT NULL DEFAULT 1,
        "line_total_cents" integer NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "order_id" integer,
        "funnel_payment_id" integer,
        "campaign_id" integer,
        "staff_user_id" integer,
        "source" character varying(40),
        "currency" character varying(10) NOT NULL DEFAULT 'usd',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_visit_addon_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_visit_addon_items_visit"
          FOREIGN KEY ("customer_visit_id")
          REFERENCES "customer_visits"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_visit_addon_items_business"
          FOREIGN KEY ("business_id")
          REFERENCES "businesses"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_visit_addon_items_customer"
          FOREIGN KEY ("customer_id")
          REFERENCES "customers"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_visit_addon_items_order"
          FOREIGN KEY ("order_id")
          REFERENCES "orders"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_visit_addon_items_payment"
          FOREIGN KEY ("funnel_payment_id")
          REFERENCES "funnel_payment"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_visit_addon_items_campaign"
          FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_visit_addon_items_staff"
          FOREIGN KEY ("staff_user_id")
          REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_visit_addon_items_visit_id"
        ON "visit_addon_items" ("customer_visit_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_visit_addon_items_business_id"
        ON "visit_addon_items" ("business_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_visit_addon_items_order_id"
        ON "visit_addon_items" ("order_id")
    `);

    // Backfill from existing visit JSON (supports unitPriceCents and legacy unitPrice dollars).
    await queryRunner.query(`
      INSERT INTO "visit_addon_items" (
        "customer_visit_id",
        "business_id",
        "customer_id",
        "name",
        "unit_price_cents",
        "qty",
        "line_total_cents",
        "sort_order",
        "order_id",
        "campaign_id",
        "staff_user_id",
        "source",
        "currency",
        "created_at"
      )
      SELECT
        v.id,
        v.business_id,
        v.customer_id,
        LEFT(TRIM(elem->>'name'), 120),
        ROUND(
          COALESCE(
            NULLIF(elem->>'unitPriceCents', '')::numeric,
            CASE
              WHEN NULLIF(elem->>'unitPrice', '') IS NOT NULL
                THEN (elem->>'unitPrice')::numeric * 100
              WHEN NULLIF(elem->>'price', '') IS NOT NULL
                THEN (elem->>'price')::numeric * 100
              ELSE 0
            END,
            0
          )
        )::int AS unit_price_cents,
        GREATEST(
          1,
          LEAST(
            99,
            ROUND(
              COALESCE(
                NULLIF(elem->>'qty', '')::numeric,
                NULLIF(elem->>'quantity', '')::numeric,
                1
              )
            )
          )
        )::int AS qty,
        (
          ROUND(
            COALESCE(
              NULLIF(elem->>'unitPriceCents', '')::numeric,
              CASE
                WHEN NULLIF(elem->>'unitPrice', '') IS NOT NULL
                  THEN (elem->>'unitPrice')::numeric * 100
                WHEN NULLIF(elem->>'price', '') IS NOT NULL
                  THEN (elem->>'price')::numeric * 100
                ELSE 0
              END,
              0
            )
          )::int
          *
          GREATEST(
            1,
            LEAST(
              99,
              ROUND(
                COALESCE(
                  NULLIF(elem->>'qty', '')::numeric,
                  NULLIF(elem->>'quantity', '')::numeric,
                  1
                )
              )
            )
          )::int
        ) AS line_total_cents,
        (ordinality - 1)::int AS sort_order,
        v.order_id,
        v.campaign_id,
        v.staff_user_id,
        CASE
          WHEN v.source = 'STAFF_LOOKUP' THEN 'scanner_purchase'
          ELSE 'qr_redeem'
        END,
        'usd',
        COALESCE(v.created_at, now())
      FROM "customer_visits" v
      CROSS JOIN LATERAL jsonb_array_elements(v.extra_items)
        WITH ORDINALITY AS t(elem, ordinality)
      WHERE v.deleted_at IS NULL
        AND v.extra_items IS NOT NULL
        AND jsonb_typeof(v.extra_items) = 'array'
        AND jsonb_array_length(v.extra_items) > 0
        AND TRIM(COALESCE(elem->>'name', '')) <> ''
        AND ROUND(
          COALESCE(
            NULLIF(elem->>'unitPriceCents', '')::numeric,
            CASE
              WHEN NULLIF(elem->>'unitPrice', '') IS NOT NULL
                THEN (elem->>'unitPrice')::numeric * 100
              WHEN NULLIF(elem->>'price', '') IS NOT NULL
                THEN (elem->>'price')::numeric * 100
              ELSE 0
            END,
            0
          )
        ) > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "visit_addon_items"`);
  }
}
