import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationExecutionRecipientTable1786579200059 implements MigrationInterface {
  name = 'CreateAutomationExecutionRecipientTable1786579200059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_execution_recipient');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation_execution_recipient" ("id" SERIAL NOT NULL, "execution_id" integer NOT NULL, "step_id" integer, "customer_id" integer NOT NULL, "node_id" integer, "phase" character varying(32), "status" character varying(32) NOT NULL, "reason" character varying(255), "attempt" integer NOT NULL DEFAULT '1', "provider_response" jsonb, "error" text, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_376baf568d2954064a1471af10d" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_2afa1faa617e9b71f532834b079' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution_recipient" ADD CONSTRAINT "FK_2afa1faa617e9b71f532834b079" FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_41029b90637c8fce7b12568b2f6' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution_recipient" ADD CONSTRAINT "FK_41029b90637c8fce7b12568b2f6" FOREIGN KEY ("step_id") REFERENCES "automation_execution_step"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_d737201eca47cdf98ff644665f0' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution_recipient" ADD CONSTRAINT "FK_d737201eca47cdf98ff644665f0" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_2e76c9101769b0f6aef4905d46a' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution_recipient" ADD CONSTRAINT "FK_2e76c9101769b0f6aef4905d46a" FOREIGN KEY ("node_id") REFERENCES "automation_node"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_execution_recipient" CASCADE`);
  }
}
