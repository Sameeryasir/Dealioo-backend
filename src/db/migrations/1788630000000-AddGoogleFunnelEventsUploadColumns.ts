import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleFunnelEventsUploadColumns1788630000000
  implements MigrationInterface
{
  name = 'AddGoogleFunnelEventsUploadColumns1788630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "google_funnel_events"
      ADD COLUMN IF NOT EXISTS "payload" jsonb,
      ADD COLUMN IF NOT EXISTS "google_response" jsonb,
      ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "last_error" text,
      ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "conversion_action" character varying(191)
    `);

    await queryRunner.query(`
      UPDATE "google_funnel_events"
      SET "status" = 'failed',
          "last_error" = COALESCE("last_error", 'legacy_pre_upload_store_only')
      WHERE "status" = 'stored'
        AND "conversion_label" IS NOT NULL
        AND "gclid" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "google_funnel_events"
      ALTER COLUMN "status" SET DEFAULT 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "google_funnel_events"
      ALTER COLUMN "status" SET DEFAULT 'stored'
    `);

    await queryRunner.query(`
      UPDATE "google_funnel_events"
      SET "status" = 'stored'
      WHERE "status" IN ('pending', 'queued', 'sent', 'failed', 'dead_letter')
    `);

    await queryRunner.query(`
      ALTER TABLE "google_funnel_events"
      DROP COLUMN IF EXISTS "conversion_action",
      DROP COLUMN IF EXISTS "sent_at",
      DROP COLUMN IF EXISTS "last_error",
      DROP COLUMN IF EXISTS "retry_count",
      DROP COLUMN IF EXISTS "google_response",
      DROP COLUMN IF EXISTS "payload"
    `);
  }
}
