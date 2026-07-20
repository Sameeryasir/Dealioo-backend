import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserSubscriptionCancelAtPeriodEnd1779590000000
  implements MigrationInterface
{
  name = 'AddUserSubscriptionCancelAtPeriodEnd1779590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_subscriptions"
      ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "cancel_requested_at" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "cancellation_reason" character varying(255),
      ADD COLUMN IF NOT EXISTS "cancellation_comment" text,
      ADD COLUMN IF NOT EXISTS "cancels_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_subscriptions"
      DROP COLUMN IF EXISTS "cancels_at",
      DROP COLUMN IF EXISTS "cancellation_comment",
      DROP COLUMN IF EXISTS "cancellation_reason",
      DROP COLUMN IF EXISTS "cancel_requested_at",
      DROP COLUMN IF EXISTS "cancel_at_period_end"
    `);
  }
}
