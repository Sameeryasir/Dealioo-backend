import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStripeWebhookEventTable1786579200038 implements MigrationInterface {
  name = 'CreateStripeWebhookEventTable1786579200038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('stripe_webhook_event');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "stripe_webhook_event" ("id" SERIAL NOT NULL, "stripe_event_id" character varying(255) NOT NULL, "event_type" character varying(128) NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_fa588ed349a3330351acce0f2c7" UNIQUE ("stripe_event_id"), CONSTRAINT "PK_3d6009ae21511f7fe9339560413" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "stripe_webhook_event" CASCADE`);
  }
}
