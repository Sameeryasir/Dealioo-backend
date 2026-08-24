import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGoogleFunnelEventsTable1780060000000
  implements MigrationInterface
{
  name = 'CreateGoogleFunnelEventsTable1780060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_tracking"
      ADD COLUMN IF NOT EXISTS "google_ads_signup_conversion_label" character varying(128)
    `);
    await queryRunner.query(`
      ALTER TABLE "business_tracking"
      ADD COLUMN IF NOT EXISTS "google_ads_purchase_conversion_label" character varying(128)
    `);
    await queryRunner.query(`
      ALTER TABLE "business_tracking"
      ADD COLUMN IF NOT EXISTS "google_ads_lead_conversion_label" character varying(128)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "google_funnel_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_id" character varying(64) NOT NULL,
        "event_name" character varying(64) NOT NULL,
        "business_id" integer NOT NULL,
        "funnel_id" integer,
        "google_ads_id" character varying(64) NOT NULL,
        "conversion_label" character varying(128),
        "send_to" character varying(191),
        "status" character varying(32) NOT NULL DEFAULT 'stored',
        "event_time" bigint NOT NULL,
        "event_source_url" text,
        "value" numeric(12,2),
        "currency" character varying(8),
        "transaction_id" character varying(128),
        "gclid" character varying(255),
        "custom_data" jsonb,
        "client_ip" character varying(64),
        "user_agent" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_google_funnel_events" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_google_funnel_events_event_id"
      ON "google_funnel_events" ("event_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_funnel_events_business_created"
      ON "google_funnel_events" ("business_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_funnel_events_funnel_created"
      ON "google_funnel_events" ("funnel_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_funnel_events_status_created"
      ON "google_funnel_events" ("status", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_google_funnel_events_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_google_funnel_events_funnel_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_google_funnel_events_business_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_google_funnel_events_event_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "google_funnel_events"`);
    await queryRunner.query(`
      ALTER TABLE "business_tracking"
      DROP COLUMN IF EXISTS "google_ads_lead_conversion_label"
    `);
    await queryRunner.query(`
      ALTER TABLE "business_tracking"
      DROP COLUMN IF EXISTS "google_ads_purchase_conversion_label"
    `);
    await queryRunner.query(`
      ALTER TABLE "business_tracking"
      DROP COLUMN IF EXISTS "google_ads_signup_conversion_label"
    `);
  }
}
