import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationExecutionTable1786579200056 implements MigrationInterface {
  name = 'CreateAutomationExecutionTable1786579200056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_execution');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation_execution" ("id" SERIAL NOT NULL, "automation_id" integer NOT NULL, "customer_id" integer NOT NULL, "current_node_id" integer NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'running', "queue_job_id" character varying(64), "total_recipients" integer NOT NULL DEFAULT '0', "emails_sent_count" integer NOT NULL DEFAULT '0', "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "attempt_number" integer NOT NULL DEFAULT '1', "next_retry_at" TIMESTAMP WITH TIME ZONE, "recipients_found" integer NOT NULL DEFAULT '0', "recipients_eligible" integer NOT NULL DEFAULT '0', "recipients_filtered" integer NOT NULL DEFAULT '0', "recipients_sent" integer NOT NULL DEFAULT '0', "recipients_failed" integer NOT NULL DEFAULT '0', "recipients_skipped" integer NOT NULL DEFAULT '0', "recipients_bounced" integer NOT NULL DEFAULT '0', "recipients_paid_during_wait" integer NOT NULL DEFAULT '0', "pass_emails_sent" integer NOT NULL DEFAULT '0', "summary" jsonb, "last_error" text, "scheduled_at" TIMESTAMP WITH TIME ZONE, "automation_version" integer, "execution_context" jsonb NOT NULL DEFAULT '{}', "last_event_id" integer, "purpose" "public"."automation_execution_purpose_enum" NOT NULL DEFAULT 'manual', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2bd81d84708785d9ce744ae4cef" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_650f201cbc61c537203560a5958' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution" ADD CONSTRAINT "FK_650f201cbc61c537203560a5958" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_699242b22cbd5b0fcd5b8021c16' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution" ADD CONSTRAINT "FK_699242b22cbd5b0fcd5b8021c16" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_e833b3e0097381659fb234ac2d1' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_execution" ADD CONSTRAINT "FK_e833b3e0097381659fb234ac2d1" FOREIGN KEY ("current_node_id") REFERENCES "automation_node"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_execution" CASCADE`);
  }
}
