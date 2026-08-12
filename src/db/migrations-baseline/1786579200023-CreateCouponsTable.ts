import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCouponsTable1786579200023 implements MigrationInterface {
  name = 'CreateCouponsTable1786579200023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('coupons');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "coupons" ("id" SERIAL NOT NULL, "campaign_id" integer NOT NULL, "funnel_id" integer, "business_id" integer NOT NULL, "customer_id" integer NOT NULL, "funnel_payment_id" integer, "qr_token" character varying(64) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'ACTIVE', "payment_status" character varying(32) NOT NULL DEFAULT 'PAID', "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL, "redeemed_at" TIMESTAMP WITH TIME ZONE, "redeemed_by_user_id" integer, "scanner_device" character varying(255), "expires_at" TIMESTAMP WITH TIME ZONE, "signup_pass_email_scheduled_at" TIMESTAMP WITH TIME ZONE, "signup_pass_email_sent_at" TIMESTAMP WITH TIME ZONE, "signup_pass_email_cancelled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d7ea8864a0150183770f3e9a8cb" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coupons_funnel_payment" ON "coupons" ("funnel_payment_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coupons_qr_token" ON "coupons" ("qr_token") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_7f82a6e658dde20514631ca745f' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "coupons" ADD CONSTRAINT "FK_7f82a6e658dde20514631ca745f" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_28336b4a9500253079213fb9b03' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "coupons" ADD CONSTRAINT "FK_28336b4a9500253079213fb9b03" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_b5aeb036d51e269ca686c9134a7' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "coupons" ADD CONSTRAINT "FK_b5aeb036d51e269ca686c9134a7" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_679c7237c31b8de322ec9935f80' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "coupons" ADD CONSTRAINT "FK_679c7237c31b8de322ec9935f80" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_0a487bfe1e122001d1197c2958c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "coupons" ADD CONSTRAINT "FK_0a487bfe1e122001d1197c2958c" FOREIGN KEY ("funnel_payment_id") REFERENCES "funnel_payment"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_2326117d6ad81572d73c73fcb17' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "coupons" ADD CONSTRAINT "FK_2326117d6ad81572d73c73fcb17" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "coupons" CASCADE`);
  }
}
