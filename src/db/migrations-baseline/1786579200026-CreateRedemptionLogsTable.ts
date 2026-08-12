import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRedemptionLogsTable1786579200026 implements MigrationInterface {
  name = 'CreateRedemptionLogsTable1786579200026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('redemption_logs');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "redemption_logs" ("id" SERIAL NOT NULL, "coupon_id" integer, "customer_id" integer, "campaign_id" integer, "business_id" integer NOT NULL, "scanned_by" integer, "scanned_at" TIMESTAMP WITH TIME ZONE NOT NULL, "device_info" text, "success" boolean NOT NULL DEFAULT false, "failure_reason" character varying(255), "event_type" character varying(32), "ip_address" character varying(64), "idempotency_key" character varying(128), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_940760ec90aca4edfab73a7e4d3" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_6590313c9ff83f111c8d59c921c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "redemption_logs" ADD CONSTRAINT "FK_6590313c9ff83f111c8d59c921c" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_1b7829c4745c383d810fd2cdcdc' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "redemption_logs" ADD CONSTRAINT "FK_1b7829c4745c383d810fd2cdcdc" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_23580d59e4911a11c82b1652198' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "redemption_logs" ADD CONSTRAINT "FK_23580d59e4911a11c82b1652198" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_d8d78a3cd2408a85b311ecef720' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "redemption_logs" ADD CONSTRAINT "FK_d8d78a3cd2408a85b311ecef720" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redemption_logs" CASCADE`);
  }
}
