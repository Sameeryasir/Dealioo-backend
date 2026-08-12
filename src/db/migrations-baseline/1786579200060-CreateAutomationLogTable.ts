import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationLogTable1786579200060 implements MigrationInterface {
  name = 'CreateAutomationLogTable1786579200060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_log');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation_log" ("id" SERIAL NOT NULL, "execution_id" integer NOT NULL, "node_id" integer NOT NULL, "customer_id" integer NOT NULL, "message" text NOT NULL, "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_334e99a100ffb2880ce0a6d8034" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_a5fb9d2aa1d54d627e323596f63' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_log" ADD CONSTRAINT "FK_a5fb9d2aa1d54d627e323596f63" FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_194b711ccc9c0f3a6bbcfb78e19' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_log" ADD CONSTRAINT "FK_194b711ccc9c0f3a6bbcfb78e19" FOREIGN KEY ("node_id") REFERENCES "automation_node"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_a50e16390ebb844c0512b5ad178' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_log" ADD CONSTRAINT "FK_a50e16390ebb844c0512b5ad178" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_log" CASCADE`);
  }
}
