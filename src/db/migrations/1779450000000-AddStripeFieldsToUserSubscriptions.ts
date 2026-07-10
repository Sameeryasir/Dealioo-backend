import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStripeFieldsToUserSubscriptions1779450000000 implements MigrationInterface {
  name = 'AddStripeFieldsToUserSubscriptions1779450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "stripe_customer_id" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "user_subscriptions"
      ADD COLUMN IF NOT EXISTS "stripe_customer_id" character varying,
      ADD COLUMN IF NOT EXISTS "stripe_subscription_id" character varying
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_subscriptions_stripe_subscription_id"
      ON "user_subscriptions" ("stripe_subscription_id")
      WHERE "stripe_subscription_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_user_subscriptions_stripe_subscription_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "user_subscriptions"
      DROP COLUMN IF EXISTS "stripe_subscription_id",
      DROP COLUMN IF EXISTS "stripe_customer_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "stripe_customer_id"
    `);
  }
}
