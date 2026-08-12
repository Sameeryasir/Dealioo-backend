import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationExecutionStepTable1786579200057 implements MigrationInterface {
  name = 'CreateAutomationExecutionStepTable1786579200057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_execution_step');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation_execution_step" ("id" SERIAL NOT NULL, "execution_id" integer NOT NULL, "node_id" integer, "step_key" character varying(64) NOT NULL, "step_label" character varying(255) NOT NULL, "phase" character varying(32), "status" character varying(32) NOT NULL DEFAULT 'pending', "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "duration_ms" integer, "recipients_total" integer NOT NULL DEFAULT '0', "recipients_sent" integer NOT NULL DEFAULT '0', "recipients_failed" integer NOT NULL DEFAULT '0', "recipients_skipped" integer NOT NULL DEFAULT '0', "error" text, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4ffe84f1d0005b53c45dbe22cc4" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_a72c180d783542cdce4850140d3' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution_step" ADD CONSTRAINT "FK_a72c180d783542cdce4850140d3" FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_99fd819f6ec8b4360dc26d90c25' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution_step" ADD CONSTRAINT "FK_99fd819f6ec8b4360dc26d90c25" FOREIGN KEY ("node_id") REFERENCES "automation_node"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_execution_step" CASCADE`);
  }
}
