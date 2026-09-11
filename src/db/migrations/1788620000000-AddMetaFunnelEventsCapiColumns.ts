import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetaFunnelEventsCapiColumns1788620000000
  implements MigrationInterface
{
  name = 'AddMetaFunnelEventsCapiColumns1788620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meta_funnel_events"
      ADD COLUMN IF NOT EXISTS "payload" jsonb,
      ADD COLUMN IF NOT EXISTS "meta_response" jsonb,
      ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "last_error" text,
      ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      UPDATE "meta_funnel_events"
      SET "status" = 'failed',
          "last_error" = COALESCE("last_error", 'legacy_pre_capi_store_only')
      WHERE "status" = 'stored'
    `);

    await queryRunner.query(`
      ALTER TABLE "meta_funnel_events"
      ALTER COLUMN "status" SET DEFAULT 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meta_funnel_events"
      ALTER COLUMN "status" SET DEFAULT 'stored'
    `);

    await queryRunner.query(`
      UPDATE "meta_funnel_events"
      SET "status" = 'stored'
      WHERE "status" IN ('pending', 'queued', 'sent', 'failed', 'dead_letter')
    `);

    await queryRunner.query(`
      ALTER TABLE "meta_funnel_events"
      DROP COLUMN IF EXISTS "sent_at",
      DROP COLUMN IF EXISTS "last_error",
      DROP COLUMN IF EXISTS "retry_count",
      DROP COLUMN IF EXISTS "meta_response",
      DROP COLUMN IF EXISTS "payload"
    `);
  }
}
