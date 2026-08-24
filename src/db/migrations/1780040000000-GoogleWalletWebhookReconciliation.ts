import { MigrationInterface, QueryRunner } from 'typeorm';

export class GoogleWalletWebhookReconciliation1780040000000
  implements MigrationInterface
{
  name = 'GoogleWalletWebhookReconciliation1780040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "google_wallet_events" (
        "id" SERIAL NOT NULL,
        "object_id" character varying(255) NOT NULL,
        "coupon_id" integer,
        "event_type" character varying(32),
        "nonce" character varying(255),
        "raw_payload" text,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_google_wallet_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "google_wallet_event_nonce_unique"
      ON "google_wallet_events" ("nonce")
      WHERE "nonce" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_wallet_events_object_id"
      ON "google_wallet_events" ("object_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_last_event" character varying(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_last_event_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN IF NOT EXISTS "google_wallet_last_synced_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_last_synced_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_last_event_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP COLUMN IF EXISTS "google_wallet_last_event"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_google_wallet_events_object_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "google_wallet_event_nonce_unique"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "google_wallet_events"
    `);
  }
}
