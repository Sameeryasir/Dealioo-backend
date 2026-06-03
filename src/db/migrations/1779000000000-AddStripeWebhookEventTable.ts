import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStripeWebhookEventTable1779000000000
  implements MigrationInterface
{
  name = 'AddStripeWebhookEventTable1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stripe_webhook_event" (
        "id" SERIAL NOT NULL,
        "stripe_event_id" character varying(255) NOT NULL,
        "event_type" character varying(128) NOT NULL,
        "processed_at" TIMESTAMPTZ,
        "last_error" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stripe_webhook_event" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stripe_webhook_event_id" UNIQUE ("stripe_event_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stripe_webhook_event_processed"
      ON "stripe_webhook_event" ("processed_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "stripe_webhook_event"`);
  }
}
