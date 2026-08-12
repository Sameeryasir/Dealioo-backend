import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrdersTable1786579200018 implements MigrationInterface {
  name = 'CreateOrdersTable1786579200018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('orders');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "orders" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'paid', "source" character varying(32) NOT NULL DEFAULT 'SCANNER', "total_amount" integer NOT NULL DEFAULT '0', "currency" character varying(10) NOT NULL DEFAULT 'usd', "paid_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_orders_business_paid_at" ON "orders" ("business_id", "paid_at") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_0e78f67403faf37092dce90d73a' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_0e78f67403faf37092dce90d73a" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "orders" CASCADE`);
  }
}
