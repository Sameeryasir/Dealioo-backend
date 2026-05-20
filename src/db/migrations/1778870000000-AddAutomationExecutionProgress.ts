import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationExecutionProgress1778870000000
  implements MigrationInterface
{
  name = 'AddAutomationExecutionProgress1778870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      ADD COLUMN IF NOT EXISTS "queue_job_id" character varying(64),
      ADD COLUMN IF NOT EXISTS "total_recipients" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "emails_sent_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "last_error" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      DROP COLUMN IF EXISTS "last_error",
      DROP COLUMN IF EXISTS "emails_sent_count",
      DROP COLUMN IF EXISTS "total_recipients",
      DROP COLUMN IF EXISTS "queue_job_id"
    `);
  }
}
