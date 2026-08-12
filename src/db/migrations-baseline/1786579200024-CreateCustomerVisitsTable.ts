import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerVisitsTable1786579200024 implements MigrationInterface {
  name = 'CreateCustomerVisitsTable1786579200024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customer_visits');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "customer_visits" ("id" SERIAL NOT NULL, "customer_id" integer NOT NULL, "campaign_id" integer NOT NULL, "business_id" integer NOT NULL, "coupon_id" integer, "order_id" integer, "staff_user_id" integer, "visit_date" TIMESTAMP WITH TIME ZONE NOT NULL, "source" character varying(32) NOT NULL DEFAULT 'QR_REDEMPTION', "order_subtotal" numeric(10,2), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6a153dfeb65fd81e0b5b79d36cc" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_visits_coupon_id" ON "customer_visits" ("coupon_id") WHERE "deleted_at" IS NULL`);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_de829a955174ff2bee6cf26e0a1' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_visits" ADD CONSTRAINT "FK_de829a955174ff2bee6cf26e0a1" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_b7e7b3d0b7e07f4b1c4552a7fca' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_visits" ADD CONSTRAINT "FK_b7e7b3d0b7e07f4b1c4552a7fca" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_1d2a2bf84373e35a941661b585c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_visits" ADD CONSTRAINT "FK_1d2a2bf84373e35a941661b585c" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_962c04ef9e9f7ae8aa0e1dd51ca' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_visits" ADD CONSTRAINT "FK_962c04ef9e9f7ae8aa0e1dd51ca" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_1080eb3b1109a12f4d94ea9d5c5' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_visits" ADD CONSTRAINT "FK_1080eb3b1109a12f4d94ea9d5c5" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_bc109ae5a103fe8d7eaecb715fe' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_visits" ADD CONSTRAINT "FK_bc109ae5a103fe8d7eaecb715fe" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_visits" CASCADE`);
  }
}
