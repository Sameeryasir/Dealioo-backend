import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessHistoryTable1786579200008 implements MigrationInterface {
  name = 'CreateBusinessHistoryTable1786579200008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_history');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "business_history" ("id" SERIAL NOT NULL, "business_id" integer, "event_type" character varying(40) NOT NULL, "description" text NOT NULL, "actor_user_id" integer, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "idempotency_key" character varying(128) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_77c0cf1b1ae6e0e8f579fb991d3" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_business_history_idempotency" ON "business_history" ("idempotency_key") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_business_history_business_occurred" ON "business_history" ("business_id", "occurred_at") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_20a88c50a206d97b86c08dd802e' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_history" ADD CONSTRAINT "FK_20a88c50a206d97b86c08dd802e" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_322ef561c4cb312fdf66c45a39d' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_history" ADD CONSTRAINT "FK_322ef561c4cb312fdf66c45a39d" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_history" CASCADE`);
  }
}
