import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerActivityTable1786579200028 implements MigrationInterface {
  name = 'CreateCustomerActivityTable1786579200028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customer_activity');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "customer_activity" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "business_id" integer NOT NULL, "customer_id" integer NOT NULL, "activity_type" character varying(32) NOT NULL, "source" character varying(32) NOT NULL, "reference_type" character varying(32), "reference_id" character varying(64), "amount" integer, "currency" character varying(10), "metadata" jsonb, "idempotency_key" character varying(180) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f7ee79120190ef522a026bde2ca" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_activity_idempotency" ON "customer_activity" ("idempotency_key") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_customer_activity_type_ref" ON "customer_activity" ("activity_type", "reference_type", "reference_id") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_customer_activity_business_customer_created" ON "customer_activity" ("business_id", "customer_id", "created_at") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_b6c195fb26c29d137c8c7ecb4a8' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_activity" ADD CONSTRAINT "FK_b6c195fb26c29d137c8c7ecb4a8" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_c4b9caf1c0e0806038a9d79423f' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_activity" ADD CONSTRAINT "FK_c4b9caf1c0e0806038a9d79423f" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_activity" CASCADE`);
  }
}
