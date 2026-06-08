import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCouponSignupPassEmailTracking1779110000000
  implements MigrationInterface
{
  name = 'AddCouponSignupPassEmailTracking1779110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD COLUMN "signup_pass_email_scheduled_at" TIMESTAMPTZ,
      ADD COLUMN "signup_pass_email_sent_at" TIMESTAMPTZ,
      ADD COLUMN "signup_pass_email_cancelled_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupons"
      DROP COLUMN IF EXISTS "signup_pass_email_cancelled_at",
      DROP COLUMN IF EXISTS "signup_pass_email_sent_at",
      DROP COLUMN IF EXISTS "signup_pass_email_scheduled_at"
    `);
  }
}
