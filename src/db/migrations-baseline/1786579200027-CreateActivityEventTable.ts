import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateActivityEventTable1786579200027 implements MigrationInterface {
  name = 'CreateActivityEventTable1786579200027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('activity_event');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "activity_event" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "customer_id" integer, "event_type" character varying(32) NOT NULL, "description" text NOT NULL, "metadata" jsonb, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "idempotency_key" character varying(128) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c2c1e9fdda754a6bf7f664d7e04" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_activity_event_idempotency" ON "activity_event" ("idempotency_key") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_activity_event_restaurant_occurred" ON "activity_event" ("business_id", "occurred_at") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_9e07bbbe5afde52e35250e5d8d6' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "activity_event" ADD CONSTRAINT "FK_9e07bbbe5afde52e35250e5d8d6" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_56c22e5a794b7b7fd85ac3be39d' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "activity_event" ADD CONSTRAINT "FK_56c22e5a794b7b7fd85ac3be39d" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "activity_event" CASCADE`);
  }
}
