import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationDeadLetterTable1786579200061 implements MigrationInterface {
  name = 'CreateAutomationDeadLetterTable1786579200061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_dead_letter');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation_dead_letter" ("id" SERIAL NOT NULL, "execution_id" integer, "automation_id" integer, "customer_id" integer, "job_name" character varying(64) NOT NULL, "job_id" character varying(128) NOT NULL, "job_data" jsonb NOT NULL DEFAULT '{}', "node_id" integer, "node_type" character varying(32), "error" text NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "status" character varying(32) NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "retried_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c3bfc701acb500f19cde52a26c6" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_01120c9a355fcf6b071c234bfa6' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_dead_letter" ADD CONSTRAINT "FK_01120c9a355fcf6b071c234bfa6" FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_dead_letter" CASCADE`);
  }
}
