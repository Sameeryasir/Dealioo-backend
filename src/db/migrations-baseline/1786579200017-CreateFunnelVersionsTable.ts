import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelVersionsTable1786579200017 implements MigrationInterface {
  name = 'CreateFunnelVersionsTable1786579200017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('funnel_versions');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "funnel_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "funnel_id" integer NOT NULL, "business_id" integer, "version_number" integer NOT NULL, "schema" jsonb NOT NULL DEFAULT '{}', "operation_id" character varying(64), "created_by" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5f326d5be3b7f63dc168bea6db3" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_funnel_versions_funnel_created" ON "funnel_versions" ("funnel_id", "created_at") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_funnel_versions_funnel_version" ON "funnel_versions" ("funnel_id", "version_number") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_73fd2582e3b9c4437a5900bd13d' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_versions" ADD CONSTRAINT "FK_73fd2582e3b9c4437a5900bd13d" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_fac0b1a5bd7dc3e1508b0007b0e' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_versions" ADD CONSTRAINT "FK_fac0b1a5bd7dc3e1508b0007b0e" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_f7319885c409b530032d98b4f4d' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_versions" ADD CONSTRAINT "FK_f7319885c409b530032d98b4f4d" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_versions" CASCADE`);
  }
}
