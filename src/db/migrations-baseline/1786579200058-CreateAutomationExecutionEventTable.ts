import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationExecutionEventTable1786579200058 implements MigrationInterface {
  name = 'CreateAutomationExecutionEventTable1786579200058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_execution_event');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation_execution_event" ("id" SERIAL NOT NULL, "execution_id" integer NOT NULL, "event_type" character varying(64) NOT NULL, "node_id" integer, "payload" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0955679167185fe26d20aec2ee5" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_8db9932b69f14b56cff86485e81' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution_event" ADD CONSTRAINT "FK_8db9932b69f14b56cff86485e81" FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_1321705730ad8c5cfb5d15d0fce' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution_event" ADD CONSTRAINT "FK_1321705730ad8c5cfb5d15d0fce" FOREIGN KEY ("node_id") REFERENCES "automation_node"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_execution_event" CASCADE`);
  }
}
